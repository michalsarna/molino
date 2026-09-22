import base64
import binascii

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import UnidentifiedImageError
from pydantic import BaseModel

from app import __version__
from app.gcode_generator import generate_gcode
from app.image_processor import machined_surface, process_image_to_heightmap, tool_path_depths
from app.params import CarveParams
from app.stl_generator import generate_stl
from app.toolpath import plan_toolpath, preview_paths, quantise

app = FastAPI(title="Molino", version=__version__)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

PREVIEW_RES  = 200    # max grid size for the 3D preview
STL_RES      = 300    # max grid size for STL export
STL_STEP_MM  = 0.5    # target STL grid spacing
GCODE_MAX    = 2000   # max grid size for G-code


class GenerateRequest(BaseModel):
    image_data: str                  # base64 data-URL or raw base64
    params: CarveParams = CarveParams()


def _load_heightmap(req: GenerateRequest, cols: int, rows: int) -> np.ndarray:
    b64 = req.image_data.split(",", 1)[-1]
    try:
        raw = base64.b64decode(b64, validate=True)
        return process_image_to_heightmap(raw, cols, rows)
    except (binascii.Error, ValueError, UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="image_data is not a valid image")


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
    aspect = p.width_mm / p.height_mm
    cols, rows = (PREVIEW_RES, max(1, int(PREVIEW_RES / aspect))) if aspect >= 1 \
                 else (max(1, int(PREVIEW_RES * aspect)), PREVIEW_RES)

    raw = _load_heightmap(req, cols, rows)
    x_step, y_step = p.width_mm / max(cols - 1, 1), p.height_mm / max(rows - 1, 1)
    path = quantise(tool_path_depths(raw * p.cut_depth, p, x_step, y_step))   # tool-centre depth, mm
    sim  = machined_surface(path, p, x_step, y_step) / p.cut_depth             # what the carve will look like

    # Plan at preview resolution, then scale to the real raster line count
    plan = plan_toolpath(path, p, x_step, y_step)
    real_rows = _grid(p.width_mm, p.height_mm, p.step_over, 10, GCODE_MAX)[1]
    estimate_min = plan.minutes(p) * real_rows / rows + 2 / 60

    return {
        "heightmap":      sim.flatten().tolist(),                    # simulated machined surface
        "path_heightmap": (path / p.cut_depth).flatten().tolist(),   # tool-centre depth the G-code follows
        "rows": rows,
        "cols": cols,
        "raster_lines": real_rows,
        "passes": plan.passes,
        "estimate_min": estimate_min,
        "toolpath": preview_paths(plan),           # planned path at preview resolution
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
    cols, rows = _grid(p.width_mm, p.height_mm, p.step_over, 10, GCODE_MAX)
    hm = _load_heightmap(req, cols, rows)
    return Response(
        content=generate_gcode(hm, p),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename=molino_v{app.version}_carve.gcode"},
    )
