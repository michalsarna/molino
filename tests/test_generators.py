import re
import struct

import numpy as np
import pytest

from app import __version__
from app.gcode_generator import Z_STEP, generate_gcode
from app.image_processor import apply_tool_geometry
from app.params import CarveParams
from app.stl_generator import generate_stl
from app.toolpath import plan_toolpath, quantise


def params(**kw):
    base = dict(width_mm=10, height_mm=10, cut_depth=3.0, wood_thickness=18,
                depth_per_pass=1.0, feed_rate=1000, plunge_rate=300, safe_height=3.0)
    base.update(kw)
    return CarveParams(**base)


# ── G-code ────────────────────────────────────────────────────────────────

def test_gcode_z_values_are_quantised_and_no_negative_zero():
    hm = np.array([[0.123, 0.456], [0.789, 0.0]], dtype=np.float32)
    code = generate_gcode(hm, params(cut_depth=2.0, depth_per_pass=2.0))
    zs = [float(z) for z in re.findall(r"Z(-?\d+\.\d+)", code)]
    assert zs and all(abs(round(z / Z_STEP) * Z_STEP - z) < 1e-9 for z in zs)
    assert "-0.0000" not in code


def test_gcode_skips_finished_rows_in_later_passes():
    # Row 0 max depth 1.2 mm, row 1 max 2.7 mm, 3 passes of 1 mm
    hm = np.array([[0.2, 0.3, 0.4], [0.9, 0.8, 0.7]], dtype=np.float32)
    code = generate_gcode(hm, params(width_mm=10, height_mm=5))
    pass3 = code.split("; --- Pass 3/3")[1]
    assert "Y0.0000" not in pass3          # row 0 skipped
    assert "Y5.0000" in pass3              # row 1 cut


def test_gcode_header_and_units():
    hm = np.full((3, 3), 0.5, dtype=np.float32)
    metric = generate_gcode(hm, params())
    imperial = generate_gcode(hm, params(units="imperial"))
    assert f"Molino v{__version__}" in metric
    assert "G21" in metric and "G20" in imperial
    assert imperial.count("G20") == 1


def test_gcode_depth_per_pass_clamped_to_cut_depth():
    hm = np.full((3, 3), 1.0, dtype=np.float32)
    code = generate_gcode(hm, params(cut_depth=2.0, depth_per_pass=5.0))
    assert "(1 pass)" in code
    assert "Z-2.0000" in code


def test_gcode_work_origin_shifts_xy():
    hm = np.full((3, 3), 0.5, dtype=np.float32)
    xs = lambda c: [float(v) for v in re.findall(r"G[01] X(-?\d+\.\d+)", c)]
    ys = lambda c: [float(v) for v in re.findall(r" Y(-?\d+\.\d+)", c)]

    bl = generate_gcode(hm, params(width_mm=10, height_mm=20))
    assert (min(xs(bl)), max(xs(bl)), min(ys(bl)), max(ys(bl))) == (0, 10, 0, 20)

    cc = generate_gcode(hm, params(width_mm=10, height_mm=20, origin="middle-center"))
    assert (min(xs(cc)), max(xs(cc)), min(ys(cc)), max(ys(cc))) == (-5, 5, -10, 10)

    tr = generate_gcode(hm, params(width_mm=10, height_mm=20, origin="top-right"))
    assert (min(xs(tr)), max(xs(tr)), min(ys(tr)), max(ys(tr))) == (-10, 0, -20, 0)
    assert "Work origin:    X0 Y0 at stock top-right" in tr


# ── Tool-path planner ─────────────────────────────────────────────────────

def _cut_points(plan):
    return np.concatenate([op[1] for op in plan.ops if op[0] == "cut"])


def test_planner_never_travels_over_wide_uncut_areas():
    # Dark rectangle in columns 20..29 of a 60-column white field; 1 mm pixels
    hm = np.zeros((10, 60), dtype=np.float32)
    hm[:, 20:30] = 1.0
    p = params(width_mm=59, height_mm=9, cut_depth=2.0, depth_per_pass=2.0)
    plan = plan_toolpath(quantise(hm, p.cut_depth), p, 1.0, 1.0)
    pts = _cut_points(plan)
    assert pts[:, 0].min() >= 20 - 1e-6 and pts[:, 0].max() <= 29 + 1e-6
    assert np.all(pts[:, 2] <= -2.0 + 1e-9)                    # only ever cutting at full depth
    assert sum(op[0] == "hop" for op in plan.ops) == 1          # one plunge, then rolls row to row


def test_planner_finishes_one_island_before_the_next():
    hm = np.zeros((8, 100), dtype=np.float32)
    hm[:, 5:15] = 1.0      # island A
    hm[:, 85:95] = 1.0     # island B, 70 mm away -> far beyond any bridging threshold
    p = params(width_mm=99, height_mm=7, cut_depth=1.0, depth_per_pass=1.0)
    plan = plan_toolpath(quantise(hm, p.cut_depth), p, 1.0, 1.0)
    in_b = _cut_points(plan)[:, 0] > 50
    assert np.count_nonzero(in_b[1:] != in_b[:-1]) == 1

    # Even a 4 mm white gap (wider than the 2 mm skim limit) must not make the tool
    # alternate between the two shapes row by row
    hm2 = np.zeros((8, 40), dtype=np.float32)
    hm2[:, 5:15] = 1.0
    hm2[:, 19:29] = 1.0
    p2 = params(width_mm=39, height_mm=7, cut_depth=1.0, depth_per_pass=1.0)
    plan2 = plan_toolpath(quantise(hm2, p2.cut_depth), p2, 1.0, 1.0)
    in_b2 = _cut_points(plan2)[:, 0] > 17
    assert np.count_nonzero(in_b2[1:] != in_b2[:-1]) == 1
    assert sum(op[0] == "hop" for op in plan2.ops) == 2


def test_planner_skims_small_white_specks_but_retracts_over_long_gaps():
    row = np.ones(80, dtype=np.float32)
    row[10] = 0.0          # 1 mm speck  -> skim across
    row[40:60] = 0.0       # 20 mm gap   -> retract
    hm = np.tile(row, (1, 1))
    p = params(width_mm=79, height_mm=1, cut_depth=1.0, depth_per_pass=1.0)
    plan = plan_toolpath(quantise(hm, p.cut_depth), p, 1.0, 1.0)
    hops = [op for op in plan.ops if op[0] == "hop"]
    assert len(hops) == 2
    assert 60 <= hops[1][1] <= 79


def test_planner_follows_strokes_instead_of_rastering_rows():
    # Two thin diagonal strokes ~35 mm apart: the tool should trace each stroke end to end
    # (rolling row to row over a 1 px white skim) and hop only once per stroke.
    hm = np.zeros((20, 60), dtype=np.float32)
    for r in range(20):
        hm[r, 5 + r] = 1.0
        hm[r, 40 + r] = 1.0
    p = params(width_mm=59, height_mm=19, cut_depth=1.0, depth_per_pass=1.0)
    plan = plan_toolpath(quantise(hm, 1.0), p, 1.0, 1.0)
    assert sum(op[0] == "hop" for op in plan.ops) == 2


def test_later_passes_link_through_finished_grooves_at_rapid_rate():
    # Deep ends, shallow middle: pass 2 must stay down and link across the finished middle
    row = np.concatenate([np.ones(10), np.full(20, 0.3), np.ones(10)]).astype(np.float32)
    hm = np.tile(row, (2, 1))
    p = params(width_mm=39, height_mm=1, cut_depth=2.0, depth_per_pass=1.0)
    plan = plan_toolpath(quantise(hm, 2.0), p, 1.0, 1.0)
    i2 = [i for i, op in enumerate(plan.ops) if op[0] == "pass"][1]
    assert sum(op[0] == "hop" for op in plan.ops[i2:]) == 1
    assert plan.link_mm > 0
    pass2 = generate_gcode(hm, p).split("Pass 2/2")[1]
    assert " F3000.0000" in pass2 and " F1000.0000" in pass2


def test_gcode_flat_runs_collapse_to_single_moves():
    hm = np.full((3, 50), 0.5, dtype=np.float32)
    code = generate_gcode(hm, params(width_mm=49, height_mm=2, cut_depth=2.0, depth_per_pass=2.0))
    assert len([l for l in code.splitlines() if l.startswith("G1 X")]) <= 3 * 2 + 3
    assert "Est. run time:" in code


# ── STL ───────────────────────────────────────────────────────────────────

def test_stl_binary_layout():
    rows, cols = 6, 8
    hm = np.random.default_rng(0).random((rows, cols), dtype=np.float32)
    data = generate_stl(hm, params())

    n_tris = struct.unpack("<I", data[80:84])[0]
    expected = 2 * (rows - 1) * (cols - 1) + 2 + 2 * (cols - 1) * 2 + 2 * (rows - 1) * 2
    assert n_tris == expected
    assert len(data) == 84 + 50 * n_tris
    assert data[:80].startswith(f"Molino v{__version__}".encode())


def test_stl_normals_are_unit_and_walls_face_outward():
    hm = np.full((4, 4), 0.5, dtype=np.float32)
    p = params(bit_type="endmill")
    data = generate_stl(hm, p)
    n = struct.unpack("<I", data[80:84])[0]
    rec = np.frombuffer(data[84:], dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")], count=n)

    lengths = np.linalg.norm(rec["n"], axis=1)
    assert np.allclose(lengths, 1.0, atol=1e-5)

    # Every triangle lying on the x=0 plane must have a -X normal
    on_left = np.all(np.isclose(rec["v"][:, :, 0], 0.0), axis=1)
    assert on_left.any() and np.all(rec["n"][on_left][:, 0] < 0)
    on_bottom = np.all(np.isclose(rec["v"][:, :, 2], 0.0), axis=1)
    assert np.all(rec["n"][on_bottom][:, 2] < 0)


# ── Tool geometry ─────────────────────────────────────────────────────────

def test_vbit_spreads_symmetrically_and_never_reduces_depth():
    hm = np.zeros((11, 11), dtype=np.float32)
    hm[5, 5] = 1.0
    out = apply_tool_geometry(hm, params(cut_depth=3.0, tip_angle=60), 0.5, 0.5)
    assert out[5, 5] == pytest.approx(1.0)
    assert np.all(out >= hm - 1e-6)
    assert out[5, 6] == pytest.approx(out[5, 4]) == pytest.approx(out[6, 5])
    assert 0 < out[5, 6] < 1.0
    assert out[0, 0] == 0.0


def test_endmill_dilates_by_radius():
    hm = np.zeros((9, 9), dtype=np.float32)
    hm[4, 4] = 1.0
    out = apply_tool_geometry(hm, params(bit_type="endmill", bit_diameter=2.0), 1.0, 1.0)
    assert out[4, 3] == out[4, 5] == out[3, 4] == 1.0    # within 1 px radius
    assert out[4, 2] == 0.0                              # beyond radius


# ── Params ────────────────────────────────────────────────────────────────

def test_params_reject_cut_deeper_than_stock():
    with pytest.raises(ValueError):
        CarveParams(cut_depth=20, wood_thickness=18)


def test_params_ignore_unknown_fields_from_frontend():
    p = CarveParams(aspect=1.5, width_mm=50)
    assert p.width_mm == 50
