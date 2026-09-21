# Feature history

Per-version changelog. New functionality summary lives in [README.md](README.md).

---

## v0.06

- **STL solid fixed** — all four side walls had inverted (inward-pointing) normals; winding corrected so every face of the exported solid has an outward normal, eliminating the hollow appearance in slicers
- **5 mm margin in 3D preview** — the wood block in the viewer extends 5 mm beyond the carved image on all sides; carved area is centered with an uncut flat border

---

## v0.05

- **3D preview overhauled** — replaced the occluding base BoxGeometry with a proper closed solid: carved top surface + 4 side walls that follow the edge heightmap + flat bottom; carved depressions are now fully visible from any angle
- **Version display** — header version badge fetched live from `/api/info` so it always matches the running server
- **`.dockerignore`** — excludes `venv/`, `.git/`, `__pycache__`, and markdown files from the Docker build context

---

## v0.04

- **SVG favicon** — CNC spindle icon (gantry bar, spindle body, V-bit tip, amber on dark background); works in all modern browsers
- **3D preview fixed** — corrected coordinate system (switched to Y-up for Three.js), fixed triangle winding for all faces, fixed base box Z position and Z-fighting; OrbitControls now behave correctly

---

## v0.03

- **Large image support** — API switched from multipart form to JSON body with a Pydantic model, eliminating the 1 MB per-part limit imposed by Starlette's `MultiPartParser`; photos of any size work
- **Metric / Imperial toggle** — switch between mm and inches in the parameters step; all values convert live using stored `data-mm` attributes; G-code outputs `G20` (imperial) or `G21` (metric) accordingly

---

## v0.02

- **Virtual environment** — project runs cleanly in a Python `venv`
- **Docker packaging** — `Dockerfile` and `docker-compose.yml` for containerised deployment

---

## v0.01

- Drag-and-drop image upload with live B&W depth-map preview
- Brightness, contrast, and color-flip controls (client-side, no server round-trip)
- Locked aspect ratio — set width in mm, height calculated automatically
- V-bit and flat end mill support
- Raster-scan G-code generation (bi-directional boustrophedon, metric, absolute positioning)
- Binary STL export of carved wood solid (top surface + base + walls)
- Interactive Three.js 3D viewer with orbit controls
- Estimated machining time shown before download
- Fully stateless — no files stored on the server
