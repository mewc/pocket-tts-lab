# tts-server — Pocket TTS sidecar

FastAPI measurement harness around [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
(CPU-only, 100M params). The Next.js UI in the parent dir talks to this over HTTP.

## Run

```bash
uv sync                                                   # install (CPU torch + pocket-tts)
uv run uvicorn server:app --host 127.0.0.1 --port 4706
```

Or from the app root: `bun run tts` (just this) / `bun run dev` (this + the web UI).

**First model use downloads weights from HuggingFace** (~hundreds of MB) into
`~/.cache/pocket_tts` and `~/.cache/huggingface`. Slow once, cached after.

## Endpoints

| Method | Path             | Purpose                                                        |
| ------ | ---------------- | ------------------------------------------------------------- |
| GET    | `/health`        | model warm state, sample rate, cpu/threads, cloning available |
| GET    | `/voices`        | predefined voices, languages, cloned voices                   |
| POST   | `/speak`         | full WAV; metrics in `X-*` response headers                   |
| POST   | `/speak/stream`  | live int16 mono PCM frames (for Web Audio playback)           |
| POST   | `/benchmark`     | warm-up + N runs → RTF / TTFB aggregates + machine facts      |
| POST   | `/clone`         | multipart audio → speaker embedding `.safetensors`            |
| POST   | `/compare/cloud` | optional: race OpenAI tts-1 (needs `OPENAI_API_KEY`)          |

## Notes

- Each **language** is a separate model — lazy-loaded and cached per language.
- pocket-tts is **not thread-safe** and pins `torch.set_num_threads(1)`, so all generation is
  serialized behind one lock and offloaded to a worker thread.
- Voice **cloning from arbitrary audio** needs the gated cloning weights; without them the
  server runs predefined-voices-only and `/clone` returns a clear 409.
