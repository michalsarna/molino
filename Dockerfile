FROM python:3.12-slim

ARG BUILD_VERSION=0.32
LABEL version="${BUILD_VERSION}" \
      maintainer="Molino"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as an unprivileged user; the app never writes to disk
RUN useradd --system --no-create-home --shell /usr/sbin/nologin molino \
 && chown -R molino:molino /app
USER molino

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/info', timeout=2).status == 200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
