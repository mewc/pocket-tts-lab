# pocket-tts-lab — single image running BOTH the Next UI and the Python Pocket TTS
# sidecar. The browser only talks to Next ($PORT); Next proxies to the sidecar on
# 127.0.0.1:$TTS_PORT in-process, so there is no CORS and no second public service.
FROM oven/bun:1-debian AS base

# uv (fast Python package manager) for the sidecar
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# libsndfile1 is needed by soundfile; the rest is TLS/curl for downloads.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libsndfile1 ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV TTS_PORT=4706 \
    TTS_VENV=/app/tts-server/.venv \
    UV_LINK_MODE=copy \
    NODE_ENV=production

# --- Python sidecar deps -----------------------------------------------------
# Install a CPU-only torch FIRST from the PyTorch CPU index so the resolver never
# pulls the multi-GB CUDA stack that the default (GPU) linux torch wheel carries.
# Then install the sidecar's own deps against that already-satisfied torch.
# NOTE: keep this list in sync with tts-server/pyproject.toml.
RUN uv venv --python 3.12 "$TTS_VENV" \
  && uv pip install --python "$TTS_VENV/bin/python" \
       torch --index-url https://download.pytorch.org/whl/cpu \
  && uv pip install --python "$TTS_VENV/bin/python" \
       pocket-tts \
       "fastapi>=0.115" \
       "uvicorn[standard]>=0.34" \
       "soundfile>=0.12" \
       "numpy>=1.26" \
       "python-multipart>=0.0.9" \
       "httpx>=0.27"

# --- Node/Next deps + build --------------------------------------------------
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Persist model weights across deploys by pointing all caches at the mounted volume
# (Railway volume mounted at /data). First request downloads; restarts reuse.
ENV XDG_CACHE_HOME=/data/cache \
    HF_HOME=/data/hf \
    HF_HUB_ENABLE_HF_TRANSFER=0
RUN mkdir -p /data/cache /data/hf

EXPOSE 4703
CMD ["bun", "run", "scripts/serve.ts"]
