# molino

> **Photo → CNC wood carving** — upload a photo, tune it, and get a G-code toolpath and STL model ready to carve.

[![Live](https://img.shields.io/badge/version-0.34-amber)](https://github.com/michalsarna/molino)

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

## Deploying on a server

- Put the container behind a reverse proxy that terminates **HTTPS** (Caddy, nginx, Traefik). Uvicorn is started with `--proxy-headers`, so the app sees the real scheme and adds `Strict-Transport-Security` when `X-Forwarded-Proto: https` arrives.
- The app sets its own security headers: a strict `Content-Security-Policy` (inline scripts allowed by hash only, everything served from the app itself), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
- Request bodies over 25 MB and images over 40 megapixels are rejected (413 / 400) before any decoding, so a malicious upload can't exhaust memory. Consider a proxy-level rate limit as well if the server is reachable from the internet.
- The container runs as an unprivileged user, has a `HEALTHCHECK` on `/api/info`, writes nothing to disk and needs no volumes.

## Security scanning

Free tooling runs on every push / PR and weekly (`.github/workflows/`):

| Tool | Scope |
|---|---|
| **pip-audit** | Known CVEs in Python dependencies |
| **Bandit** | Python static analysis |
| **CodeQL** | Code scanning for Python and JavaScript (vendored Three.js excluded) |
| **Gitleaks** | Secrets in the repository history |
| **Hadolint** | Dockerfile best practices |
| **Trivy** | OS and library CVEs in the built image; Dockerfile / compose misconfiguration report |
| **Dependabot** | Update PRs for pip, Docker base image, GitHub Actions and the pinned Three.js version (`package.json` — a bump there is a reminder to re-vendor `app/static/vendor/three`) |

## Privacy

- **No cookies**, no accounts, no analytics, no tracking — the server sets no cookies and the client sets none.
- **Browser storage:** a single `localStorage` item (`theme`) is written only when you press the theme button; the in-app *Privacy & browser storage* notice (footer) shows what is stored and offers a one-click "forget".
- **Your image** is sent to the server only when you generate a preview or a download, processed in memory for that request and never written to disk.
- **No third parties:** all assets, including Three.js, are served from the app itself — it also works offline.

Under the EU ePrivacy rules this means no consent banner is required: the only device storage is a user-chosen UI preference, which is exempt, and there is no third-party data transfer. Operators should still be aware that their web server / reverse proxy may log IP addresses.

## Versioning & contributing

Branch names correspond to version numbers (`XX.yy` format). All changes to `master` go through pull requests. Each merged PR bumps the version. Per-version history is in [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
