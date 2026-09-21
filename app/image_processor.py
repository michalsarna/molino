import io
import math
import numpy as np
from PIL import Image
from numpy.lib.stride_tricks import sliding_window_view


def apply_tool_geometry(heightmap: np.ndarray, bit_type: str, bit_diameter_mm: float,
                         tip_angle_deg: float, cut_depth_mm: float,
                         x_step_mm: float, y_step_mm: float) -> np.ndarray:
    """
    Compute the actual machined surface for the given tool geometry.

    This should be applied to the heightmap for STL and preview only.
    G-code depths are programmed at the raw desired depth; the physical
    tool spreading happens on the machine and must not be double-counted.

    V-bit (cone tip):
        Each raster cut propagates to neighbouring pixels via the V-shape
        sides.  Modelled as a separable max-dilation with a linear (ramp)
        kernel in Y then X (Manhattan-distance approximation of the cone).
        The result shows the actual carved surface between raster passes,
        including the characteristic inter-pass ridges.

    Flat end mill:
        The flat circular bottom sweeps a disc of radius R.  Deeper cuts
        spread outward; modelled as a max-filter (dilation) with radius R.
        Fine raised details narrower than R get cut away; fine dark grooves
        widen to the bit diameter.
    """
    if cut_depth_mm <= 0:
        return heightmap

    if bit_type == "endmill" and bit_diameter_mm > 0:
        r_px = max(1, round(bit_diameter_mm / 2 / ((x_step_mm + y_step_mm) / 2)))
        size = 2 * r_px + 1
        padded = np.pad(heightmap, r_px, mode="edge")
        windows = sliding_window_view(padded, (size, size))
        return np.minimum(1.0, np.max(windows, axis=(-2, -1)).astype(heightmap.dtype))

    if bit_type == "vbit" and 0 < tip_angle_deg < 180:
        tan_half = math.tan(math.radians(tip_angle_deg / 2))
        if tan_half <= 0:
            return heightmap

        max_reach_mm = cut_depth_mm * tan_half
        reach_y = max(1, math.ceil(max_reach_mm / y_step_mm))
        reach_x = max(1, math.ceil(max_reach_mm / x_step_mm))

        rows, cols = heightmap.shape
        depths = heightmap * cut_depth_mm   # convert to mm for dilation

        # Y-direction pass: spread each cut upward/downward via V-sides
        padded_y = np.pad(depths, ((reach_y, reach_y), (0, 0)), mode="edge")
        temp = np.zeros_like(depths)
        for di in range(-reach_y, reach_y + 1):
            src = padded_y[reach_y + di : reach_y + di + rows, :]
            np.maximum(temp, src - abs(di) * y_step_mm / tan_half, out=temp)

        # X-direction pass: spread laterally via V-sides
        padded_x = np.pad(temp, ((0, 0), (reach_x, reach_x)), mode="edge")
        result = np.zeros_like(temp)
        for dj in range(-reach_x, reach_x + 1):
            src = padded_x[:, reach_x + dj : reach_x + dj + cols]
            np.maximum(result, src - abs(dj) * x_step_mm / tan_half, out=result)

        return np.clip(result / cut_depth_mm, 0.0, 1.0).astype(heightmap.dtype)

    return heightmap


def process_image_to_heightmap(image_bytes: bytes, cols: int, rows: int = None) -> np.ndarray:
    """
    Convert a grayscale image to a normalized heightmap.
    Returns 2D float32 array: 0.0 = no cut (white), 1.0 = max cut (black).
    The frontend sends an already-adjusted grayscale image.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("L")

    if rows is None:
        orig_w, orig_h = img.size
        rows = max(1, int(cols * orig_h / orig_w))

    img = img.resize((cols, rows), Image.LANCZOS)
    arr = np.array(img, dtype=np.float32) / 255.0
    # Invert: black pixel (0) → full cut depth (1.0), white (1) → no cut (0.0)
    # Flip rows: image row-0 (top) maps to high-Y so it appears at the top
    # of the standard top-down view instead of upside-down.
    return np.ascontiguousarray((1.0 - arr)[::-1, :])
