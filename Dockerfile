FROM node:22-alpine AS frontend

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ICEVUE_CATALOG_CONFIG=/app/config/catalogs.yaml \
    ICEVUE_STATIC_DIR=/app/frontend/dist

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY icevue/ ./icevue/
RUN pip install --no-cache-dir .
COPY --from=frontend /build/frontend/dist ./frontend/dist

RUN mkdir -p /app/config \
    && useradd --create-home --uid 10001 icevue \
    && chown -R icevue:icevue /app
USER icevue

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"

CMD ["uvicorn", "icevue.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
