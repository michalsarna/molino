import io
import math

import numpy as np
from PIL import Image

from app.params import CarveParams


def _profile_filter(depths: np.ndarray, reach: int, axis: int, ramp_per_px: float, op) -> np.ndarray:
    """
    Separable morphological filter along one axis with a linear tool profile.
    op=np.minimum → erosion:  a source k px away contributes value + k*ramp (tool may not go deeper)
    op=np.maximum → dilation: a source k px away contributes value - k*ramp (tool flank cuts there)
    ramp_per_px = 0 gives a flat (end mill) profile.
    """
    n = depths.shape[axis]
    pad = [(0, 0), (0, 0)]
    pad[axis] = (reach, reach)
    padded = np.pad(depths, pad, mode="edge")
    sign = 1.0 if op is np.minimum else -1.0

    out = depths.copy()
    for k in range(-reach, reach + 1):
        if k == 0:
            continue
        sl = [slice(None), slice(None)]
        sl[axis] = slice(reach + k, reach + k + n)
        op(out, padded[tuple(sl)] + sign * abs(k) * ramp_per_px, out=out)
    return out


def _kernel(p: CarveParams, x_step: float, y_step: float):
    """(reach_y_px, reach_x_px, ramp_y_mm_per_px, ramp_x_mm_per_px) describing the tool profile."""
    if p.bit_type == "endmill":
        r = p.bit_diameter / 2
        return max(1, round(r / y_step)), max(1, round(r / x_step)), 0.0, 0.0
    tan_half = math.tan(math.radians(p.tip_angle / 2))
    reach_mm = p.cut_depth * tan_half
    return (max(1, math.ceil(reach_mm / y_step)), max(1, math.ceil(reach_mm / x_step)),
            y_step / tan_half, x_step / tan_half)


def tool_path_depths(target_mm: np.ndarray, p: CarveParams, x_step: float, y_step: float) -> np.ndarray:
    """
    Tool-centre depth (mm) at every pixel: the deepest the tool may go without cutting below
    the target anywhere under its footprint. Erosion of the target by the tool profile — this
    is what the G-code drives, and why narrow or steep features keep material with a big tool.
    """
    ry, rx, my, mx = _kernel(p, x_step, y_step)
    out = _profile_filter(target_mm, ry, 0, my, np.minimum)
    return _profile_filter(out, rx, 1, mx, np.minimum)


def machined_surface(path_mm: np.ndarray, p: CarveParams, x_step: float, y_step: float) -> np.ndarray:
    """Depth (mm) the tool actually leaves when its centre follows path_mm: dilation by the tool profile."""
    ry, rx, my, mx = _kernel(p, x_step, y_step)
    out = _profile_filter(path_mm, ry, 0, my, np.maximum)
    return _profile_filter(out, rx, 1, mx, np.maximum)


def apply_tool_geometry(heightmap: np.ndarray, p: CarveParams, x_step: float, y_step: float) -> np.ndarray:
    """Normalised heightmap → normalised carved result (opening by the tool). Used for STL/preview."""
    target = heightmap * p.cut_depth
    sim = machined_surface(tool_path_depths(target, p, x_step, y_step), p, x_step, y_step)
    return (sim / p.cut_depth).astype(heightmap.dtype)


def process_image_to_heightmap(image_bytes: bytes, cols: int, rows: int) -> np.ndarray:
    """
    Grayscale image -> float32 heightmap in [0, 1]: 0 = no cut (white), 1 = max cut (black).
    Rows are flipped so image top maps to high Y (standard top-down CNC view).
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("L").resize((cols, rows), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.ascontiguousarray((1.0 - arr)[::-1, :])
