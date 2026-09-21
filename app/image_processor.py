import io
import numpy as np
from PIL import Image
from numpy.lib.stride_tricks import sliding_window_view


def apply_tool_compensation(heightmap: np.ndarray, bit_type: str, bit_diameter_mm: float,
                             x_step_mm: float, y_step_mm: float) -> np.ndarray:
    """
    Apply tool-geometry constraints to a heightmap.

    For a flat end mill the bit can't carve features narrower than its diameter:
    a minimum filter (morphological erosion) models this by reducing depths in
    areas smaller than the bit footprint so the programmed paths never over-cut
    surrounding material.  V-bit tips are a point, so no path compensation is
    needed for them.
    """
    if bit_type != "endmill" or bit_diameter_mm <= 0:
        return heightmap

    avg_step = (x_step_mm + y_step_mm) / 2
    r_px = max(1, round(bit_diameter_mm / 2 / avg_step))
    size = 2 * r_px + 1
    padded = np.pad(heightmap, r_px, mode="edge")
    windows = sliding_window_view(padded, (size, size))
    return np.min(windows, axis=(-2, -1)).astype(heightmap.dtype)


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
