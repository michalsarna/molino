import io
import struct
import numpy as np

from app.image_processor import apply_tool_geometry


def _triangle(buf: io.BytesIO, v1, v2, v3):
    e1 = np.subtract(v2, v1)
    e2 = np.subtract(v3, v1)
    n = np.cross(e1, e2)
    length = np.linalg.norm(n)
    if length:
        n = n / length
    buf.write(struct.pack("<fff", *n))
    buf.write(struct.pack("<fff", *v1))
    buf.write(struct.pack("<fff", *v2))
    buf.write(struct.pack("<fff", *v3))
    buf.write(struct.pack("<H", 0))


def generate_stl(heightmap: np.ndarray, params: dict) -> bytes:
    rows, cols = heightmap.shape

    width_mm = float(params.get("width_mm", 100.0))
    height_mm = float(params.get("height_mm", 100.0))
    cut_depth_mm = float(params.get("cut_depth", 3.0))
    wood_thickness = float(params.get("wood_thickness", 18.0))

    x_step = width_mm / max(cols - 1, 1)
    y_step = height_mm / max(rows - 1, 1)

    # Simulate actual machined surface (tool spreading / V-cone inter-pass shape)
    bit_type     = params.get("bit_type", "vbit")
    bit_diameter = float(params.get("bit_diameter", 3.175))
    tip_angle    = float(params.get("tip_angle", 60.0))
    heightmap = apply_tool_geometry(heightmap, bit_type, bit_diameter,
                                    tip_angle, cut_depth_mm, x_step, y_step)

    # z_top[i,j] = z coordinate of carved surface at grid point (i,j)
    z_top = wood_thickness - heightmap * cut_depth_mm

    # Count triangles: top surface + bottom + 4 sides
    top_tris = 2 * (rows - 1) * (cols - 1)
    bottom_tris = 2
    side_tris = 2 * (cols - 1) * 2 + 2 * (rows - 1) * 2
    total = top_tris + bottom_tris + side_tris

    buf = io.BytesIO()
    buf.write(b"Molino v0.13" + b" " * (80 - len("Molino v0.13")))
    buf.write(struct.pack("<I", total))

    # Top surface
    for i in range(rows - 1):
        for j in range(cols - 1):
            x0, y0 = j * x_step, i * y_step
            x1, y1 = (j + 1) * x_step, i * y_step
            x2, y2 = j * x_step, (i + 1) * y_step
            x3, y3 = (j + 1) * x_step, (i + 1) * y_step
            z00, z10 = float(z_top[i, j]), float(z_top[i, j + 1])
            z01, z11 = float(z_top[i + 1, j]), float(z_top[i + 1, j + 1])
            _triangle(buf, (x0, y0, z00), (x1, y0, z10), (x2, y2, z01))
            _triangle(buf, (x1, y0, z10), (x3, y3, z11), (x2, y2, z01))

    # Bottom face (Z=0, -Z normal outward)
    # CCW from below (-Z): (0,0)→(0,H)→(W,H)→(W,0)
    _triangle(buf, (0, 0, 0), (0, height_mm, 0), (width_mm, height_mm, 0))
    _triangle(buf, (0, 0, 0), (width_mm, height_mm, 0), (width_mm, 0, 0))

    # Front wall (y=0, normal -Y)
    for j in range(cols - 1):
        x0, x1 = j * x_step, (j + 1) * x_step
        zt0, zt1 = float(z_top[0, j]), float(z_top[0, j + 1])
        _triangle(buf, (x0, 0, 0), (x1, 0, 0), (x1, 0, zt1))
        _triangle(buf, (x0, 0, 0), (x1, 0, zt1), (x0, 0, zt0))

    # Back wall (y=height_mm, normal +Y)
    for j in range(cols - 1):
        x0, x1 = j * x_step, (j + 1) * x_step
        zt0, zt1 = float(z_top[rows - 1, j]), float(z_top[rows - 1, j + 1])
        _triangle(buf, (x0, height_mm, 0), (x0, height_mm, zt0), (x1, height_mm, zt1))
        _triangle(buf, (x0, height_mm, 0), (x1, height_mm, zt1), (x1, height_mm, 0))

    # Left wall (x=0, normal -X)
    for i in range(rows - 1):
        y0, y1 = i * y_step, (i + 1) * y_step
        zt0, zt1 = float(z_top[i, 0]), float(z_top[i + 1, 0])
        _triangle(buf, (0, y0, 0), (0, y0, zt0), (0, y1, zt1))
        _triangle(buf, (0, y0, 0), (0, y1, zt1), (0, y1, 0))

    # Right wall (x=width_mm, normal +X)
    for i in range(rows - 1):
        y0, y1 = i * y_step, (i + 1) * y_step
        zt0, zt1 = float(z_top[i, cols - 1]), float(z_top[i + 1, cols - 1])
        _triangle(buf, (width_mm, y0, 0), (width_mm, y1, zt1), (width_mm, y0, zt0))
        _triangle(buf, (width_mm, y0, 0), (width_mm, y1, 0), (width_mm, y1, zt1))

    return buf.getvalue()
