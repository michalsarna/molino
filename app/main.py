from typing import Any

import numpy as np
from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.gcode_generator import generate_gcode
from app.image_processor import process_image_to_heightmap
from app.stl_generator import generate_stl

app = FastAPI(title="Molino", version="0.14")

app.mount("/static", StaticFiles(directory="app/static"), name="static")

PREVIEW_RES = 200
STL_RES = 300
GCODE_MAX = 2000


class GenerateRequest(BaseModel):
    image_data: str           # base64 data-URL or raw base64
    params: dict[str, Any] = {}


@app.get("/api/info")
async def info():
    return {"version": app.version, "title": app.title}


@app.get("/")
async def index():
    return FileResponse("app/static/index.html")


def _decode_image(b64: str) -> bytes:
    import base64
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)


def _clamp_resolution(width_mm: float, height_mm: float, step_mm: float, max_steps: int):
    cols = max(10, min(max_steps, int(width_mm / step_mm)))
    rows = max(10, min(max_steps, int(height_mm / step_mm)))
    return cols, rows


@app.post("/api/preview")
async def preview(req: GenerateRequest):
    p = req.params
    img_bytes = _decode_image(req.image_data)

    aspect = float(p.get("aspect", 1.0))
    cols = PREVIEW_RES
    rows = max(1, int(cols / aspect))
    if rows > PREVIEW_RES:
        rows = PREVIEW_RES
        cols = max(1, int(rows * aspect))

    hm = process_image_to_heightmap(img_bytes, cols, rows)

    # Simulate actual machined surface so the preview matches STL
    from app.image_processor import apply_tool_geometry
    width_mm  = float(p.get("width_mm",  100.0))
    height_mm = float(p.get("height_mm", 100.0))
    cut_depth = float(p.get("cut_depth", 3.0))
    x_step = width_mm  / max(cols - 1, 1)
    y_step = height_mm / max(rows - 1, 1)
    bit_type     = p.get("bit_type", "vbit")
    bit_diameter = float(p.get("bit_diameter", 3.175))
    tip_angle    = float(p.get("tip_angle", 60.0))
    hm = apply_tool_geometry(hm, bit_type, bit_diameter, tip_angle, cut_depth, x_step, y_step)

    return {
        "heightmap": hm.flatten().tolist(),
        "rows": int(hm.shape[0]),
        "cols": int(hm.shape[1]),
    }


@app.post("/api/download/stl")
async def download_stl(req: GenerateRequest):
    p = req.params
    img_bytes = _decode_image(req.image_data)

    width_mm = float(p.get("width_mm", 100.0))
    height_mm = float(p.get("height_mm", 100.0))

    cols = min(STL_RES, max(50, int(width_mm / 0.5)))
    rows = min(STL_RES, max(50, int(height_mm / 0.5)))

    hm = process_image_to_heightmap(img_bytes, cols, rows)
    stl_bytes = generate_stl(hm, p)

    return Response(
        content=stl_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename=molino_v{app.version}_carve.stl"},
    )


@app.post("/api/download/gcode")
async def download_gcode(req: GenerateRequest):
    p = req.params
    img_bytes = _decode_image(req.image_data)

    width_mm = float(p.get("width_mm", 100.0))
    height_mm = float(p.get("height_mm", 100.0))
    step_over = float(p.get("step_over", 0.25))

    cols, rows = _clamp_resolution(width_mm, height_mm, step_over, GCODE_MAX)

    hm = process_image_to_heightmap(img_bytes, cols, rows)
    gcode = generate_gcode(hm, p)

    return Response(
        content=gcode,
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=molino_v{app.version}_carve.gcode"},
    )
