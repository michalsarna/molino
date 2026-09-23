FROM python:3.12-slim

ARG BUILD_VERSION=0.27
LABEL version="${BUILD_VERSION}" \
      maintainer="Molino"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
