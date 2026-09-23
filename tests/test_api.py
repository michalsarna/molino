import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import __version__
from app.main import app

client = TestClient(app)


@pytest.fixture
def png_b64():
    img = Image.new("L", (40, 20))
    for x in range(40):
        for y in range(20):
            img.putpixel((x, y), int(255 * x / 39))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_info_reports_version():
    r = client.get("/api/info")
    assert r.status_code == 200
    assert r.json()["version"] == __version__


def test_preview_returns_grid_matching_aspect(png_b64):
    r = client.post("/api/preview", json={"image_data": png_b64,
                                          "params": {"width_mm": 200, "height_mm": 100}})
    assert r.status_code == 200
    body = r.json()
    step = 3.175 * 0.25                                          # default: 25% of the 3.175 mm tool
    cols, rows = int(200 / step), int(100 / step)
    assert body["cols"] == cols and body["rows"] == rows
    assert body["raster_lines"] == rows and body["step_over_mm"] == pytest.approx(step)
    n = cols * rows
    assert len(body["heightmap"]) == len(body["path_heightmap"]) == len(body["leftover"]) == n
    assert 0 <= body["unreachable_pct"] <= 100 and body["leftover_max_mm"] >= 0
    assert body["estimate_min"] > 0 and body["passes"] >= 1 and body["raster_lines"] >= 10
    tp = body["toolpath"]
    assert tp["cuts"] and all(len(poly) >= 5 and (len(poly) - 1) % 2 == 0 for poly in tp["cuts"])
    assert all(len(h) == 4 for h in tp["hops"])
    # Tool dilation can only deepen the surface, never lift it above the programmed tip depth
    # Machined surface is the tool path dilated by the tool, so never shallower than the path
    assert all(h >= r - 1e-6 for h, r in zip(body["heightmap"], body["path_heightmap"]))


def test_auto_step_over_changes_the_plan_with_tool_angle(png_b64):
    def plan(angle):
        r = client.post("/api/preview", json={"image_data": png_b64, "params": {
            "width_mm": 50, "height_mm": 25, "step_over_mode": "auto", "max_ridge": 0.1, "tip_angle": angle}})
        assert r.status_code == 200
        b = r.json()
        return b["raster_lines"], b["step_over_mm"], b["ridge_mm"]
    lines60, step60, ridge60 = plan(60)
    lines45, step45, ridge45 = plan(45)
    assert lines45 > lines60 and step45 < step60
    assert ridge60 == pytest.approx(0.1, abs=1e-6) and ridge45 == pytest.approx(0.1, abs=1e-6)


def test_invalid_image_is_a_400():
    r = client.post("/api/preview", json={"image_data": "data:image/png;base64,!!!notbase64"})
    assert r.status_code == 400
    r = client.post("/api/preview", json={"image_data": base64.b64encode(b"hello").decode()})
    assert r.status_code == 400


def test_invalid_params_are_a_422(png_b64):
    r = client.post("/api/preview", json={"image_data": png_b64,
                                          "params": {"cut_depth": 50, "wood_thickness": 18}})
    assert r.status_code == 422
    r = client.post("/api/preview", json={"image_data": png_b64, "params": {"bit_type": "laser"}})
    assert r.status_code == 422


def test_downloads_produce_files(png_b64):
    common = {"image_data": png_b64, "params": {"width_mm": 30, "height_mm": 15, "step_over_pct": 30}}
    stl = client.post("/api/download/stl", json=common)
    assert stl.status_code == 200 and stl.content[:6] == b"Molino"
    gc = client.post("/api/download/gcode", json=common)
    assert gc.status_code == 200 and gc.text.startswith("; ====") and "M2" in gc.text
