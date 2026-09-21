# molino

> **Photo → CNC wood carving** — upload a photo, tune it, and get a G-code toolpath and STL model ready to carve.

[![Live](https://img.shields.io/badge/version-0.14-amber)](https://github.com/michalsarna/molino)

## What it does

1. **Upload any photo** and adjust it in the browser (brightness, contrast, color inversion) — images are never written to disk.
2. The photo is converted to a **grayscale depth map**: black pixels become the deepest cut, white pixels are left uncut, grays are everything in between.
3. Set your **machining parameters** (bit type, cut depth, step-over, spindle speed, feed rate, etc.) and physical wood size.
4. **Preview** the result as an interactive 3D visualization of the carved wood piece (with a 5 mm uncarved border).
5. Download the **STL** (closed solid, correct outward normals) and the **G-code** ready for your CNC machine.

## Features

- Live browser-side depth-map preview — brightness, contrast, invert, no server round-trip
- Locked aspect ratio: set width, height calculated automatically from the image
- Metric / Imperial unit toggle; G-code outputs `G20`/`G21` accordingly
- V-bit and flat end mill support
- Raster-scan G-code (bi-directional boustrophedon, absolute positioning)
- Binary STL export — proper closed solid with outward normals on all faces
- Interactive Three.js 3D viewer with orbit controls and 5 mm uncarved margin
- Fully stateless — no files stored on the server

## Requirements

- Python 3.10+ (for local / venv run)
- Docker + Docker Compose (for container run)

## Quick start

### Local (virtual environment)

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Then open [http://localhost:8000](http://localhost:8000).

### Docker

```bash
docker compose up --build
```

Then open [http://localhost:8000](http://localhost:8000).

To run in the background:

```bash
docker compose up -d --build
docker compose down             # stop
```

## Machining parameters

| Parameter | Description |
|-----------|-------------|
| Width (mm) | Physical carving width; height is auto-calculated from image aspect ratio |
| Bit type | V-bit or flat end mill |
| Bit diameter | Spindle/bit diameter in mm |
| Tip angle | Included angle for V-bits (e.g. 60°, 90°) |
| Max cut depth | Deepest point of the carving in mm |
| Wood thickness | Total thickness of the wood stock |
| Step over | Distance between adjacent passes in mm (smaller = finer detail, more time) |
| Depth per pass | Maximum Z increment per raster pass; multiple passes are generated until full depth is reached |
| Spindle speed | RPM |
| Feed rate | XY cutting speed in mm/min |
| Plunge rate | Z plunge speed in mm/min |
| Safe height | Z height for rapid moves between passes |

## Versioning & contributing

Branch names correspond to version numbers (`XX.yy` format). All changes to `master` go through pull requests. Each merged PR bumps the version. Per-version feature history is in [FEATURES.md](FEATURES.md).

## License

MIT — see [LICENSE](LICENSE).
