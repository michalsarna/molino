FROM python:3.14-slim

ARG BUILD_VERSION=0.35
LABEL version="${BUILD_VERSION}" \
      maintainer="Molino"

WORKDIR /app

COPY requirements.txt .
# Install the app's dependencies, then drop the installer tooling: pip (with its vendored
# msgpack) and setuptools are not needed at runtime and only add CVE surface to the image.
RUN pip install --no-cache-dir -r requirements.txt \
 && pip uninstall -y pip setuptools wheel

COPY . .

# Run as an unprivileged user with a fixed numeric UID/GID (hadolint DL3066: numeric ids
# stay resolvable by the host / orchestrator); the app never writes to disk
RUN groupadd --system --gid 10001 molino \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin molino \
 && chown -R 10001:10001 /app
USER 10001:10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/info', timeout=2).status == 200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
