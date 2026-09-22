import io
import math

import numpy as np
from PIL import Image

from app.params import CarveParams


def _dilate_1d(depths: np.ndarray, reach: int, axis: int, drop_per_px: float) -> np.ndarray:
    """Max-dilation along one axis. A source k px away contributes (value - k*drop_per_px)."""
    n = depths.shape[axis]
    pad = [(0, 0), (0, 0)]
    pad[axis] = (reach, reach)
    padded = np.pad(depths, pad, mode="edge")

    out = depths.copy()
    for k in range(-reach, reach + 1):
        if k == 0:
            continue
        sl = [slice(None), slice(None)]
        sl[axis] = slice(reach + k, reach + k + n)
        np.maximum(out, padded[tuple(sl)] - abs(k) * drop_per_px, out=out)
    return out


def apply_tool_geometry(heightmap: np.ndarray, p: CarveParams,
                        x_step_mm: float, y_step_mm: float) -> np.ndarray:
    """
    Simulate the surface the tool actually leaves. Used for STL and preview only —
    G-code programs the raw target depth; the physical tool spreading happens on
    the machine and must not be applied twice.
    """
    if p.bit_type == "endmill":
        # Flat bottom sweeps its full width: square dilation by the bit radius.
        r = p.bit_diameter / 2
        out = _dilate_1d(heightmap, max(1, round(r / y_step_mm)), 0, 0.0)
        return _dilate_1d(out, max(1, round(r / x_step_mm)), 1, 0.0)

    # V-bit: cone sides cut neighbours; depth falls off linearly with distance.
    tan_half = math.tan(math.radians(p.tip_angle / 2))
    reach_mm = p.cut_depth * tan_half
    depths = heightmap * p.cut_depth
    out = _dilate_1d(depths, max(1, math.ceil(reach_mm / y_step_mm)), 0, y_step_mm / tan_half)
    out = _dilate_1d(out, max(1, math.ceil(reach_mm / x_step_mm)), 1, x_step_mm / tan_half)
    return (out / p.cut_depth).astype(heightmap.dtype)


def process_image_to_heightmap(image_bytes: bytes, cols: int, rows: int) -> np.ndarray:
    """
    Grayscale image -> float32 heightmap in [0, 1]: 0 = no cut (white), 1 = max cut (black).
    Rows are flipped so image top maps to high Y (standard top-down CNC view).
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("L").resize((cols, rows), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.ascontiguousarray((1.0 - arr)[::-1, :])
