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
    assert body["cols"] == 200 and body["rows"] == 100
    assert len(body["heightmap"]) == 200 * 100
    assert len(body["raw_heightmap"]) == 200 * 100
    # Tool dilation can only deepen the surface, never lift it above the programmed tip depth
    assert all(h >= r - 1e-6 for h, r in zip(body["heightmap"], body["raw_heightmap"]))


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
    common = {"image_data": png_b64, "params": {"width_mm": 30, "height_mm": 15, "step_over": 1.0}}
    stl = client.post("/api/download/stl", json=common)
    assert stl.status_code == 200 and stl.content[:6] == b"Molino"
    gc = client.post("/api/download/gcode", json=common)
    assert gc.status_code == 200 and gc.text.startswith("; ====") and "M2" in gc.text
