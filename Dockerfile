FROM python:3.12-slim-trixie

# Pick up Debian security updates released since the upstream image was built.
# Rebuild with --pull --no-cache to refresh both the base and this layer.
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY src/ ./src/
# The base image's installer is also scanned; update it before installing.
RUN python -m pip install --no-cache-dir --upgrade "pip>=26.2" \
    && python -m pip install --no-cache-dir . \
    && python -m pip check \
    && python -m pip uninstall -y pip

ENV TOYBARU_DATA_DIR=/data
RUN mkdir -p /data
RUN adduser --disabled-password --gecos "" --no-create-home --uid 1000 app && chown app:app /data
USER app
EXPOSE 8099

CMD ["toybaru", "dashboard", "--host", "0.0.0.0"]
