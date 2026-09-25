import io
import math

import numpy as np
from PIL import Image

from app.params import CarveParams

# ~6300x6300; the frontend already downsizes to 1200 px. Checked before decoding, so a
# decompression-bomb PNG is rejected cheaply; Pillow's own (larger) limit stays as a backstop.
MAX_IMAGE_PIXELS = 40_000_000


# ── Tool profiles ─────────────────────────────────────────────────────────
# k(d) = height of the cutter surface above its lowest point at horizontal distance d
# from the axis, defined for d <= cutter radius. Beyond the cutter radius the tool
# does not exist (the shank is above the cut), so no constraint applies there.

def _profile(p: CarveParams):
    R = p.bit_diameter / 2
    if p.bit_type == "endmill":
        return R, None                                   # flat: k = 0, handled by the fast disc path
    if p.bit_type == "ballnose":
        return R, lambda d: R - math.sqrt(max(R * R - d * d, 0.0))
    tan_half = math.tan(math.radians(p.tip_angle / 2))
    return R, lambda d: d / tan_half                     # V cone, truncated at the cutter radius


# ── Morphology on a regular grid with true Euclidean footprints ──────────

def _running_extreme(a: np.ndarray, w: int, op) -> np.ndarray:
    """Centred sliding-window min/max of odd width w along axis 0 (van Herk / Gil-Werman, O(N))."""
    if w <= 1:
        return a
    h = w // 2
    n = a.shape[0]
    extra = -(n + 2 * h) % w
    padded = np.pad(a, [(h, h + extra)] + [(0, 0)] * (a.ndim - 1), mode="edge")
    m = padded.shape[0]
    blocks = padded.reshape(m // w, w, *padded.shape[1:])
    prefix = op.accumulate(blocks, axis=1).reshape(m, *padded.shape[1:])
    suffix = op.accumulate(blocks[:, ::-1], axis=1)[:, ::-1].reshape(m, *padded.shape[1:])
    return op(suffix[:n], prefix[w - 1:w - 1 + n])


def _flat_disc(depths: np.ndarray, R: float, xs: float, ys: float, op) -> np.ndarray:
    """Exact disc min/max filter: one O(N) column pass per horizontal offset."""
    rx = int(R / xs)
    H, W = depths.shape
    padded = np.pad(depths, ((0, 0), (rx, rx)), mode="edge")
    out = depths.copy()
    for dx in range(-rx, rx + 1):
        half = math.sqrt(max(R * R - (dx * xs) ** 2, 0.0))
        w = 2 * int(half / ys) + 1
        op(out, _running_extreme(padded[:, rx + dx:rx + dx + W], w, op), out=out)
    return out


def _shaped(depths: np.ndarray, R: float, k, xs: float, ys: float, op, sign: float) -> np.ndarray:
    """Min-plus / max-minus filter with a radial profile k(d) over the disc of radius R."""
    ry, rx = int(R / ys), int(R / xs)
    H, W = depths.shape
    padded = np.pad(depths, ((ry, ry), (rx, rx)), mode="edge")
    out = depths.copy()
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            if dy == 0 and dx == 0:
                continue
            d = math.hypot(dx * xs, dy * ys)
            if d > R:
                continue
            op(out, padded[ry + dy:ry + dy + H, rx + dx:rx + dx + W] + sign * k(d), out=out)
    return out


def _filter(depths, p, xs, ys, op, sign):
    R, k = _profile(p)
    if k is None:
        return _flat_disc(depths, R, xs, ys, op)
    return _shaped(depths, R, k, xs, ys, op, sign)


def tool_path_depths(target_mm: np.ndarray, p: CarveParams, x_step: float, y_step: float) -> np.ndarray:
    """
    Tool-centre depth (mm) at every pixel: the deepest the tool may go without cutting below
    the target anywhere under its footprint (erosion by the tool profile). This is what the
    G-code drives, and why narrow or steep features keep material with a big or blunt tool.
    """
    return _filter(target_mm, p, x_step, y_step, np.minimum, +1.0)


def machined_surface(path_mm: np.ndarray, p: CarveParams, x_step: float, y_step: float) -> np.ndarray:
    """Depth (mm) the tool actually leaves when its centre follows path_mm (dilation by the tool profile)."""
    return _filter(path_mm, p, x_step, y_step, np.maximum, -1.0)


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
    img = Image.open(io.BytesIO(image_bytes))
    if img.width * img.height > MAX_IMAGE_PIXELS:      # header is parsed lazily: reject before decoding
        raise ValueError("image has too many pixels")
    img = img.convert("L").resize((cols, rows), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.ascontiguousarray((1.0 - arr)[::-1, :])
