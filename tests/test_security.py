import base64
import hashlib
import io
import re

from fastapi.testclient import TestClient
from PIL import Image

import app.main as main
from app.main import app

client = TestClient(app)


def test_security_headers_on_pages_and_api():
    for r in (client.get("/"), client.get("/api/info")):
        assert r.status_code == 200
        h = r.headers
        assert h["x-content-type-options"] == "nosniff"
        assert h["x-frame-options"] == "DENY"
        assert h["referrer-policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in h["content-security-policy"]
        assert "'unsafe-inline'" not in h["content-security-policy"]
        assert "strict-transport-security" not in h            # plain http request


def test_csp_hashes_match_the_inline_scripts():
    html = main.INDEX_HTML.read_text(encoding="utf-8")
    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S)
    assert len(inline) == 2                                     # theme bootstrap + importmap
    csp = client.get("/").headers["content-security-policy"]
    for body in inline:
        digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        assert f"'sha256-{digest}'" in csp
    assert 'style="' not in html                                # style-src 'self' has no inline styles to allow


def test_hsts_only_when_forwarded_as_https():
    r = client.get("/api/info", headers={"x-forwarded-proto": "https"})
    assert r.headers["strict-transport-security"].startswith("max-age=")


def test_oversized_requests_are_rejected(monkeypatch):
    monkeypatch.setattr(main, "MAX_IMAGE_B64", 100)
    img = Image.new("L", (40, 20), 128)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    assert client.post("/api/preview", json={"image_data": b64}).status_code == 413


def test_decompression_bomb_is_a_400_not_an_oom():
    img = Image.new("1", (8000, 6000), 1)                      # 48 Mpx, only a few KB as PNG
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    assert len(buf.getvalue()) < 200_000
    b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    r = client.post("/api/preview", json={"image_data": b64})
    assert r.status_code == 400
