# Changelog

Per-version history. Feature overview lives in [README.md](README.md).

---

## v0.34

- **Dependency refresh** — after the merged Dependabot PRs (FastAPI ≥ 0.141, uvicorn, Pillow ≥ 12.3, NumPy ≥ 2.5, pytest ≥ 9.1, `python:3.14-slim`, Actions on Node 24), this release closes the remaining gaps: uvicorn ≥ 0.54 and, above all, the **vendored Three.js is actually updated to r186 (0.186.1)** — Dependabot had bumped only the `package.json` pin while the served copy was still r157. Newer builds ship as `three.module.js` + `three.core.js`, both now vendored; the test that checks served assets covers the new file
- **Version bumped to 0.34**

---

## v0.33

- **Fix: stale tool path in the viewer** — since the live carve screen keeps one Three.js scene, each re-plan disposed the previous tool-path group but never removed it from the scene, so paths stacked up (visible after changing the physical size). The old group is now removed before the new one is added
- **Version bumped to 0.33**

---

## v0.32

- **Security scanning (all free)** — GitHub Actions workflows: pip-audit + Bandit, Gitleaks, Hadolint + Trivy (image CVEs fail the build on fixed HIGH/CRITICAL; misconfiguration is report-only), and CodeQL for Python and JavaScript; Dependabot for pip, Docker, Actions and a pinned `package.json` that tracks Three.js advisories for the vendored copy
- **Security headers** — strict `Content-Security-Policy` with the two inline scripts allowed by SHA-256 hash computed from `index.html` at startup (no `unsafe-inline`), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`; HSTS when the request is forwarded as HTTPS
- **Upload guards for a public server** — bodies over 25 MB → 413, images over 40 Mpx rejected before decoding (a decompression-bomb PNG is a 400, not an OOM)
- **Container hardening** — runs as an unprivileged user, `HEALTHCHECK` on `/api/info`, uvicorn started with `--proxy-headers`
- README: deployment notes and scanner overview
- **Version bumped to 0.32**

---

## v0.31

- **Step bar fixed** — the v0.30 translation wrapper made the badge styling apply to the label text, squeezing it into a 20 px circle. Badge and label now have their own classes; labels no longer wrap, the active badge uses the theme colours, and "done" steps show an outlined amber badge instead of a hard-coded green
- **Logo icon** — the favicon (gantry + V-bit) replaces the ▶ glyph next to "molino"
- **Version bumped to 0.31**

---

## v0.30

- **Multilanguage UI** — English, Polish and German, chosen from a selector in the header. The browser language is used by default; a choice is remembered (`lang` in local storage) only when you pick one, and the privacy notice and "forget" button cover it. All static text, tooltips, the stats line, origin names, tool labels and error messages are translated; the G-code header stays in English as the technical lingua franca
- Dictionaries are plain JSON in `app/static/i18n/` — add a file and an `<option>` to add a language. A test checks key parity and placeholders across languages and that the page and script reference only known keys
- **Version bumped to 0.30**

---

## v0.29

- **Live carve screen** — steps 2 and 3 are merged: machining parameters sit in a left pane and the 3D preview, path plan, stats and download buttons in a sticky right pane. Any parameter change re-plans automatically (400 ms debounce); a newer edit cancels the in-flight request. The current mesh stays on screen until the new result lands, the camera is re-framed only when the block dimensions change, and an "Updating…" pill replaces the blocking overlay
- Preview errors (e.g. cut deeper than the stock while typing) show inline in the info line instead of an alert; fields mid-edit (empty) don't trigger a request
- Image adjustments made after a preview invalidate it, so returning to the carve screen re-plans
- Downloads are enabled once the first preview has been generated
- **Version bumped to 0.29**

---

## v0.28

- **Privacy / ePrivacy compliance** — audit found no cookies anywhere (none set by the server, none by the client). Two things were tightened so no consent banner is required:
  - The theme is written to `localStorage` **only when you press the theme button** (a user-chosen UI preference is exempt from consent; an automatic write on page load is not). A "Forget my theme choice" button removes it
  - **Three.js is now self-hosted** (`app/static/vendor/three`, MIT) instead of loaded from the jsDelivr CDN, so no visitor IP is disclosed to a third party — and the app works offline
- **Privacy & browser storage notice** — footer link opens a plain-language dialog: cookies (none), local storage (what, when, how to remove), image handling (in memory, never stored), third parties (none), server logs
- Test asserts no `Set-Cookie` headers, no external script URLs, and that the vendored library is served
- **Version bumped to 0.28**

---

## v0.27

- **Light / dark theme** — toggle button in the header (☀ / ☾). Defaults to the system preference, remembered in the browser, applied before first paint so there's no flash. The 3D viewer background and ground grid follow the theme; native form controls switch via `color-scheme`
- **Version bumped to 0.27**

---

## v0.26

- **Step over as % of tool diameter** — spacing is now entered as a percentage of the bit diameter (default 25 %), so it scales with the tool automatically; *Auto from finish* remains available. The mm value it produces is shown in the export info and G-code header
- `FEATURES.md` renamed to `CHANGELOG.md`
- **Version bumped to 0.26**

---

## v0.25

- **Step over: Auto from finish** — new mode derives the raster spacing from the tool profile and a *Max ridge* (scallop) parameter: V-bit `2·h·tan(θ/2)`, ball nose `2·√(2Rh − h²)`, flat end mill `h / steepest slope` (capped at 80 % of the diameter). A 45° bit therefore gets tighter lines than a 60° bit and a ball nose far wider ones for the same finish — the plan, line count and run time now follow the tool on smooth surfaces where the tool-offset path alone is identical
- **Ridge height reported** for manual spacing too, in the export info and the G-code header (`; Ridge height: … between passes for this tool`), so two tools on the same image never produce indistinguishable files
- Preview returns `step_over_mm` and `ridge_mm`; in auto mode the Spacing field shows the derived value
- **Version bumped to 0.25**

---

## v0.24

- **Descriptive G-code file name** — includes carve size and tool in the active unit system, e.g. `molino_v0.24_photo_200x150mm_vbit60deg-3.175mm.gcode` or `…_8x6in_ballnose-0.25in.gcode`
- **Version bumped to 0.24**

---

## v0.23

- **Accurate tool footprints** — tool-offset and simulation now use true Euclidean profiles instead of separable square/Manhattan approximations. An end mill is a disc (the square version blocked the tool 41 % too far from diagonal and curved edges); a V-bit is a cone **truncated at the cutter radius** (the old infinite cone let a 3.175 mm bit be constrained by neighbours 5.8 mm away). Both shrink the unreachable bands along shape edges — this, not path direction, is what limits how close a given tool gets to a side
- **Ball-nose tool** — new bit type with a spherical profile; reaches into relief detail a flat end mill can't while leaving a smoother surface than a V-bit
- **Preview grid matches G-code** — up to 400×400 following the step-over, so small tools aren't rounded up to oversized footprints in the preview
- Flat-disc filters run in O(N) per offset (van Herk running min/max), so large tools on large carves stay fast
- **Version bumped to 0.23**

---

## v0.22

- **Unreachable-material highlight** — the preview tints the carved surface magenta wherever the target is deeper than the selected tool can reach (graded, full tint at 20 % of the cut depth or 1 mm, whichever is larger); toggle in the viewer, on by default. This is the visible signature of bit diameter / tip angle: a bigger or blunter tool lights up more of the image
- **Unreachable stat** — export info shows the share of the carve the tool can't fully reach and the largest leftover depth
- **Path drawn at real raster spacing** — preview rows now follow the step-over (up to 400 rows), so the tool-path overlay shows the actual line density instead of a fixed 200-row grid
- **Stale preview re-plans automatically** — changing any parameter marks the preview stale; entering step 3 via the step indicator regenerates instead of showing the old result
- Preview payload values rounded to 4 decimals
- **Version bumped to 0.22**

---

## v0.21

- **True tool-offset paths** — the G-code now drives the tool *centre* along the image eroded by the tool profile (min-filter with a flat disc for end mills, a cone for V-bits), so the bit never cuts below the target anywhere under its footprint. A V-bit stays shallow next to a white edge instead of flaring into it; an end mill can't enter features narrower than its diameter and leaves them uncut. Path, run time and file therefore change with bit diameter and tip angle
- **Simulation is now the opening** — preview and STL show dilate(erode(target)): the material the tool genuinely leaves, including rounded corners and uncut narrow detail
- Preview returns `path_heightmap` (tool-centre depth) instead of the raw image depth; the red overlay follows it
- G-code header notes the tool-offset behaviour
- **Version bumped to 0.21**

---

## v0.20

- **Stroke-following planner** — the pass is now a walk over segments rather than a row raster. From the end of a segment the tool rolls into the overlapping segment on the row above or below and keeps going (this traces strokes in line art and serpentines solid areas); only when nothing is reachable does it retract and hop to the nearest unvisited segment. Line drawings no longer get hopped across on every row
- **Link moves** — travel over pixels finished in an earlier pass runs along the existing groove at rapid rate (`G1 F<rapid>`) instead of cutting feed; staying down is therefore always cheaper than retract → rapid → plunge, and rows are split only at never-cut white stretches longer than 2 mm
- **Preview shows the real plan** — the tool-path overlay is now built from the planner output: red = cutting, blue = link through a finished groove, grey = rapid hop. Previously it drew every raw row regardless of the path
- G-code header lists link distance separately in the run-time estimate
- **Version bumped to 0.20**

---

## v0.19

- **Tool-path planner** (`app/toolpath.py`) replaces full-width raster rows:
  - Each pass visits only pixels that still have material to remove; white areas and already-finished regions are no longer traversed
  - Runs on a row are merged across small gaps when skimming is cheaper than retract → rapid → plunge (cost model from feed, rapid and plunge rates and retract height); never-cut gaps are skimmed at Z0 only if ≤ 2 mm, otherwise the tool retracts
  - Runs on adjacent rows are grouped into islands; each island is carved with its own serpentine before moving to the nearest remaining island
  - Rows inside an island are chained without retracting whenever the end column meets the next segment
  - Flat runs at constant Z collapse to a single `G1` — much smaller files
- **New machine parameters** — Rapid rate (default 3000 mm/min) and Retract height (default 1 mm, used for hops inside the carve; Safe height is used at start/end only)
- **Accurate run-time estimate** — G-code header lists estimated time with cut / rapid / plunge distances; the preview's estimate now comes from the planner instead of a rough formula
- **Version bumped to 0.19**

---

## v0.18

- **No-cut / max-cut level handles** — the depth bar on the Image step now carries two draggable handles. Gray levels lighter than the left handle become "no cut", darker than the right handle become "max cut", and everything between is remapped linearly. The bar redraws to show the active range and the labels show the thresholds (0–255). Applied client-side after brightness/contrast/invert, so preview, STL and G-code all see the same result
- **Version bumped to 0.18**

---

## v0.17

- **Work-origin picker** — 3×3 grid in Machine Parameters selects where X0 Y0 sits on the stock (corners, edge midpoints or centre); single selection, default bottom-left. G-code X/Y are shifted accordingly and the header records the choice. Z0 remains the stock top
- **Origin marker in 3D preview** — cyan dot with red (+X) / green (+Y) arms shows the selected origin on the stock surface
- Export info shows the selected origin
- **Version bumped to 0.17**

---

## v0.16

- **Tool-tip path overlay** — toggle in the 3D preview (top-right of the viewer) draws the programmed path of the cutting tool's tip in red along every raster row; shows the exact depth the G-code commands, as opposed to the wider surface the bit leaves behind (visible as the gap between red line and carved surface with V-bits / end mills)
- `/api/preview` now returns `raw_heightmap` (programmed depth) alongside the simulated `heightmap`
- **Version bumped to 0.16**

---

## v0.15

- **Full code review & refactor**
  - Single validated `CarveParams` model replaces ad-hoc `params.get(...)` with scattered, inconsistent defaults; bad input (e.g. cut deeper than stock, unknown bit type) now returns 422 instead of silently defaulting
  - Malformed / non-image `image_data` returns 400 instead of a 500
  - Version lives in one place (`app.__version__`) and is read by the API, G-code header and STL header
  - STL generation vectorised with NumPy — seconds → milliseconds for a 300×300 grid
  - End-mill dilation rewritten as separable 1D passes (was a 2D sliding window whose memory grew with bit-diameter²)
  - 3D viewer: fixed leaked `requestAnimationFrame` loop and `resize` listener on every "Generate Preview"
  - Image adjustments: PNG encoding moved from every slider tick to send-time; slider redraws coalesced per frame
  - Filenames keep Unicode letters (e.g. `zdjęcie` no longer becomes `zdj_cie`)
  - Removed unused `python-multipart` dependency, dead code and duplicated parameters
- **Tests** — `pytest` suite covering G-code quantisation/row-skipping, STL binary layout and normals, tool geometry, params validation and the HTTP API (`pip install -r requirements-dev.txt && pytest`)
- **Version bumped to 0.15**

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
