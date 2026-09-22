import struct

import numpy as np

from app import __version__
from app.image_processor import apply_tool_geometry
from app.params import CarveParams

_RECORD = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("attr", "<u2")])


def _pack(tris: np.ndarray) -> bytes:
    """(N,3,3) triangle vertices -> binary STL records with computed unit normals."""
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    length = np.linalg.norm(n, axis=1, keepdims=True)
    n = np.divide(n, length, out=np.zeros_like(n), where=length > 0)

    rec = np.zeros(len(tris), dtype=_RECORD)
    rec["n"] = n
    rec["v"] = tris
    return rec.tobytes()


def _wall(top: np.ndarray, flip: bool) -> np.ndarray:
    """Quad strip from a polyline of top points down to Z=0. `flip` reverses the winding."""
    bottom = top.copy()
    bottom[:, 2] = 0.0
    b0, b1, t0, t1 = bottom[:-1], bottom[1:], top[:-1], top[1:]
    if flip:
        return np.concatenate([np.stack([b0, t0, t1], 1), np.stack([b0, t1, b1], 1)])
    return np.concatenate([np.stack([b0, b1, t1], 1), np.stack([b0, t1, t0], 1)])


def generate_stl(heightmap: np.ndarray, p: CarveParams) -> bytes:
    rows, cols = heightmap.shape
    x_step = p.width_mm / max(cols - 1, 1)
    y_step = p.height_mm / max(rows - 1, 1)

    heightmap = apply_tool_geometry(heightmap, p, x_step, y_step)
    z_top = p.wood_thickness - heightmap * p.cut_depth

    xs = np.arange(cols, dtype=np.float32) * x_step
    ys = np.arange(rows, dtype=np.float32) * y_step
    X, Y = np.meshgrid(xs, ys)
    P = np.stack([X, Y, z_top.astype(np.float32)], axis=-1)   # (rows, cols, 3)

    # Carved top surface: two triangles per grid cell, +Z outward
    a, b, c, d = P[:-1, :-1], P[:-1, 1:], P[1:, :-1], P[1:, 1:]
    top = np.concatenate([
        np.stack([a, b, c], axis=2).reshape(-1, 3, 3),
        np.stack([b, d, c], axis=2).reshape(-1, 3, 3),
    ])

    W, H = p.width_mm, p.height_mm
    bottom = np.array([
        [[0, 0, 0], [0, H, 0], [W, H, 0]],
        [[0, 0, 0], [W, H, 0], [W, 0, 0]],
    ], dtype=np.float32)

    walls = np.concatenate([
        _wall(P[0, :],  flip=False),   # front  y=0, -Y outward
        _wall(P[-1, :], flip=True),    # back   y=H, +Y outward
        _wall(P[:, 0],  flip=True),    # left   x=0, -X outward
        _wall(P[:, -1], flip=False),   # right  x=W, +X outward
    ])

    tris = np.concatenate([top, bottom, walls]).astype(np.float32)

    header = f"Molino v{__version__}".encode().ljust(80, b" ")
    return header + struct.pack("<I", len(tris)) + _pack(tris)
