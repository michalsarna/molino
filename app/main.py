import base64
import binascii
import hashlib
import re
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from app import __version__
from app.finish import auto_step_over, ridge_height
from app.gcode_generator import generate_gcode
from app.image_processor import machined_surface, process_image_to_heightmap, tool_path_depths
from app.params import CarveParams
from app.stl_generator import generate_stl
from app.toolpath import plan_toolpath, preview_paths, quantise

app = FastAPI(title="Molino", version=__version__)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

INDEX_HTML    = Path("app/static/index.html")
MAX_BODY      = 25 * 1024 * 1024   # bytes; a 1200 px PNG as base64 is a few MB
MAX_IMAGE_B64 = 20 * 1024 * 1024   # characters of image_data


def _inline_script_hashes(html: str) -> str:
    """CSP hashes for the page's inline scripts (theme bootstrap, importmap), so no 'unsafe-inline'."""
    bodies = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S | re.IGNORECASE)
    return " ".join(f"'sha256-{base64.b64encode(hashlib.sha256(b.encode()).digest()).decode()}'" for b in bodies)


CSP = "; ".join([
    "default-src 'self'",
    f"script-src 'self' {_inline_script_hashes(INDEX_HTML.read_text(encoding='utf-8'))}",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


@app.middleware("http")
async def security(request: Request, call_next):
    if request.method == "POST" and int(request.headers.get("content-length") or 0) > MAX_BODY:
        return JSONResponse({"detail": "request body too large"}, status_code=413)
    response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    if request.headers.get("x-forwarded-proto", request.url.scheme) == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

PREVIEW_MAX  = 400    # preview grid follows the real raster spacing up to this many cols/rows
STL_RES      = 300    # max grid size for STL export
STL_STEP_MM  = 0.5    # target STL grid spacing
GCODE_MAX    = 2000   # max grid size for G-code


class GenerateRequest(BaseModel):
    image_data: str                  # base64 data-URL or raw base64
    params: CarveParams = CarveParams()


def _load_heightmap(req: GenerateRequest, cols: int, rows: int) -> np.ndarray:
    if len(req.image_data) > MAX_IMAGE_B64:
        raise HTTPException(status_code=413, detail="image too large")
    b64 = req.image_data.split(",", 1)[-1]
    try:
        raw = base64.b64decode(b64, validate=True)
        return process_image_to_heightmap(raw, cols, rows)
    except (binascii.Error, ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail="image_data is not a valid image")


def _step_over(req: GenerateRequest, p: CarveParams) -> tuple[float, float]:
    """Effective raster spacing and the target's steepest slope (needed for flat end mills)."""
    slope = 0.0
    if p.bit_type == "endmill":
        hm = _load_heightmap(req, 400, max(10, int(400 * p.height_mm / p.width_mm)))
        gy, gx = np.gradient(hm * p.cut_depth,
                             p.height_mm / max(hm.shape[0] - 1, 1), p.width_mm / max(hm.shape[1] - 1, 1))
        slope = float(np.hypot(gx, gy).max())
    step = (p.bit_diameter * p.step_over_pct / 100 if p.step_over_mode == "percent"
            else auto_step_over(p, slope))
    return step, slope


def _grid(width_mm: float, height_mm: float, step_mm: float, lo: int, hi: int) -> tuple[int, int]:
    cols = max(lo, min(hi, int(width_mm / step_mm)))
    rows = max(lo, min(hi, int(height_mm / step_mm)))
    return cols, rows


@app.get("/api/info")
async def info():
    return {"version": app.version, "title": app.title}


@app.get("/")
async def index():
    return FileResponse("app/static/index.html")


@app.post("/api/preview")
async def preview(req: GenerateRequest):
    p = req.params
    # Grid follows the real raster spacing (capped) so tool footprints and line density match the G-code
    step, slope = _step_over(req, p)
    real_cols, real_rows = _grid(p.width_mm, p.height_mm, step, 10, GCODE_MAX)
    cols, rows = min(PREVIEW_MAX, real_cols), min(PREVIEW_MAX, real_rows)

    raw = _load_heightmap(req, cols, rows)
    x_step, y_step = p.width_mm / max(cols - 1, 1), p.height_mm / max(rows - 1, 1)
    target   = raw * p.cut_depth
    path     = quantise(tool_path_depths(target, p, x_step, y_step))   # tool-centre depth, mm
    sim      = machined_surface(path, p, x_step, y_step)               # what the carve will look like
    leftover = np.clip(target - sim, 0, None)                          # material the tool cannot reach
    to_cut   = target > 0.05
    unreachable_pct = float(100 * (leftover[to_cut] > 0.05).mean()) if to_cut.any() else 0.0

    plan = plan_toolpath(path, p, x_step, y_step)
    estimate_min = plan.minutes(p) * real_rows / rows + 2 / 60

    def norm(a):
        return np.round(a / p.cut_depth, 3).flatten().tolist()   # 0.001 of cut depth ≈ Z_STEP

    return {
        "heightmap":       norm(sim),
        "path_heightmap":  norm(path),
        "leftover":        norm(leftover),
        "leftover_max_mm": float(leftover.max()),
        "unreachable_pct": unreachable_pct,
        "rows": rows,
        "cols": cols,
        "raster_lines": real_rows,
        "step_over_mm": step,
        "ridge_mm": ridge_height(p, step, slope),
        "passes": plan.passes,
        "estimate_min": estimate_min,
        "toolpath": preview_paths(plan),
    }


@app.post("/api/download/stl")
async def download_stl(req: GenerateRequest):
    p = req.params
    cols, rows = _grid(p.width_mm, p.height_mm, STL_STEP_MM, 50, STL_RES)
    hm = _load_heightmap(req, cols, rows)
    return Response(
        content=generate_stl(hm, p),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename=molino_v{app.version}_carve.stl"},
    )


@app.post("/api/download/gcode")
async def download_gcode(req: GenerateRequest):
    p = req.params
    step, _ = _step_over(req, p)
    cols, rows = _grid(p.width_mm, p.height_mm, step, 10, GCODE_MAX)
    hm = _load_heightmap(req, cols, rows)
    return Response(
        content=generate_gcode(hm, p),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=molino_v{app.version}_carve.gcode"},
    )
