# Feature history

Per-version changelog. New functionality summary lives in [README.md](README.md).

---

## v0.14

- **G-code Z precision** — all depths quantized to 0.01 mm (machine step resolution); Z move emitted only when change ≥ 0.01 mm so programmed path = executed path
- **Smart pass skipping** — in passes 2+ the generator skips entire rows whose deepest pixel was already cut to its final depth in an earlier pass; avoids re-traversing finished material and surface damage
- **G-code header** — now shows Z step and updated pass range (`depth A → depth B`) per pass
- **Estimated time in h/mm** — export info now shows `1h 23m` instead of raw minutes
- **Version bumped to 0.14**

---

## v0.13

- **Export info cleaned up** — renamed "passes" to "raster lines" (CNC-correct); added tool label (bit type, angle, diameter); time estimate now includes depth passes and plunge time
- **Original filename in downloads** — STL and G-code files are named `molino_vX.YY_<original_image_name>_carve.*`
- **Version bumped to 0.13**

---

## v0.12

- **Docker image versioning** — `docker-compose.yml` now tags the built image as `molino:0.12` and passes `BUILD_VERSION` as a build arg; `Dockerfile` records it as an image `LABEL`
- **STL header updated** — binary STL header string corrected from `v0.06` to current version
- **Version bumped to 0.12**

---

## v0.11

- **Flip horizontal / flip vertical** — two new toggle controls in the Image step; applied client-side before sending to server, so STL, G-code, and 3D preview all reflect the flip
- **3D viewer orientation fixed** — reversed the Z-axis mapping in the viewer and centred the camera so the carved image appears in the same orientation as the original photo (no longer rotated relative to the upload)
- **Tool change in G-code** — `T1 M6` command added before spindle start; includes a comment to remove it if the machine has no ATC
- **Version bumped to 0.11**

---

## v0.10

- **Clickable step indicators** — click any step badge in the nav to jump to it; step 2 requires an image to be loaded, step 3 requires a preview to have been generated
- **Clickable logo** — clicking "molino" in the header reloads the page, starting a fresh session
- **Version in download filenames** — STL and G-code files are now named `molino_vX.YY_carve.stl` / `molino_vX.YY_carve.gcode`
- **G-code optimised** — removed one redundant move and one standalone feedrate line per row (saves ~2 lines per raster row); feedrate is now set inline on the first lateral G1 move after each plunge

---

## v0.09

- **Depth per pass** — new machining parameter (default 1 mm); the G-code generator now makes multiple raster passes, each limited to `N × depth_per_pass`, preventing tool breakage on deep cuts; pass count shown in the G-code header comment

---

## v0.08

- **Image orientation fixed** — heightmap rows were mapped so image-top landed at Y=0 (the near/bottom of the standard top-down view), making the carving appear upside-down / mirrored; rows are now flipped in `image_processor` so image-top maps to the far/high-Y end, matching the original photo orientation in the STL, G-code, and 3D preview

---

## v0.07

- **STL bottom face fixed** — bottom face had inverted winding (+Z instead of −Z normal), causing slicers and viewers to render the solid mirrored; all six faces now have verified outward normals
- **Default width 200 mm** — more practical starting point for typical carving work
- **Default max cut depth 10 mm** — raised from 3 mm to better suit common stock removal depths

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
