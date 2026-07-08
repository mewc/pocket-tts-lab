# Pocket TTS Lab

A local test bench for [Kyutai **Pocket TTS**](https://github.com/kyutai-labs/pocket-tts) —
a 100M-parameter, CPU-only, MIT-licensed text-to-speech model. Run it, feel it, and
**measure** the claims yourself (≈6× real-time, ~200 ms to first audio, 5-second voice
cloning, 6 languages) — no GPU, no API, no keys.

**Live demo: [tts-demo.drummerduck.com](https://tts-demo.drummerduck.com)** (runs on a CPU box —
the first request warms the model, then it's instant).

> Not affiliated with Kyutai. This is an independent harness around their open-source model.

## What's inside

A Next.js UI plus a small Python sidecar that owns the model:

- **Pick a voice** — choose a voice, type a line, hear it synthesized on your CPU in
  milliseconds. Streams frame-by-frame via Web Audio so you can feel the low first-chunk latency.
- **Converse** — a live voice call: mic → speech-to-text → a brain replies → Pocket TTS speaks
  it back, with a turn-by-turn timeline and every latency logged on a green→red gradient. Barge
  in by talking over it.
- **Benchmark** — warm-up-excluded timed runs; real-time-factor and time-to-first-chunk vs the
  claimed 6× / 200 ms, with machine facts so the numbers are honest.
- **Clone** — record ~5 s or upload a clip → speaker embedding → speak in that voice.
- **Why care** — cost / offline / not-an-LLM explainer with the live-measured numbers.

Measured here on an Apple-Silicon Mac (single torch thread, 24 kHz): **RTF ≈ 8.9×**,
**time-to-first-chunk ≈ 35 ms** — it beats the headline claims.

## Quick start

Requires [Bun](https://bun.sh) and [uv](https://docs.astral.sh/uv/)
(`curl -LsSf https://astral.sh/uv/install.sh | sh`).

```bash
bun install          # JS deps
bun run tts:sync     # Python deps (CPU torch + pocket-tts) — heavy first run
bun run dev          # boots the UI (:4703) + the TTS sidecar (:4706)
```

Open **http://localhost:4703**.

> **First model use downloads weights from HuggingFace** (~hundreds of MB) into
> `~/.cache/pocket_tts` and `~/.cache/huggingface`. Slow once, cached after — not a bug.

`bun run dev:web` / `bun run tts` run the two halves independently.

## Architecture

```
browser ──▶ Next.js UI (:4703) ──/api/tts proxy──▶ FastAPI sidecar (:4706) ──▶ Pocket TTS
```

The browser only talks to Next; `app/api/tts/[...path]` proxies to the Python sidecar
(`tts-server/`, `uv`-managed) so there's one origin, no CORS, and streaming passes through.
The sidecar lazy-loads one model per language, caches voice states, and serializes generation
behind a lock (Pocket TTS is not thread-safe and pins `torch.set_num_threads(1)`).

## Optional keys (`.env.local`)

Everything works with **zero keys**. These only enable extras:

| Variable | Enables |
| --- | --- |
| `XAI_API_KEY` (Grok) / `OPENAI_API_KEY` | A real LLM brain for the **Converse** tab (else a scripted local demo brain). Grok preferred. |
| `OPENAI_API_KEY` | The optional cloud-TTS latency/cost race in **Why care**. |

## Honest caveats

- **Speech-to-text** in Converse uses the **browser's** Web Speech API (Chrome/Edge). In Chrome
  that part may use the browser's cloud STT — it's labeled in the UI. The **TTS is 100% local**,
  which is the point. For the cleanest barge-in, use headphones.
- **Voice cloning from arbitrary audio** needs Kyutai's gated cloning weights; without them the
  model runs predefined-voices-only and the Clone tab says so.
- The default Converse brain is a **scripted local demo** — it can't look things up or reason.
  Add an LLM key for real answers.

## Deploy (Docker / Railway)

The whole thing ships as **one container** (`Dockerfile`): the Next server and the Python
sidecar run side by side, and Next proxies to the sidecar on `127.0.0.1` — so there's a single
public port and no CORS. It reads `PORT` (the public web port) and `TTS_PORT` (internal sidecar).

```bash
docker build -t pocket-tts-lab .
docker run -p 4703:4703 -v pocket-tts-cache:/data pocket-tts-lab
```

On **Railway**, `railway.json` selects the Dockerfile builder and a `/api/tts/health` healthcheck.
Mount a **volume at `/data`** so downloaded model weights (`XDG_CACHE_HOME`/`HF_HOME` point there)
survive restarts — otherwise every cold start re-downloads them. CPU inference is slower than an
Apple-Silicon Mac, so give it a couple of vCPUs and ≥2 GB RAM for a snappy demo.

## Credits & license

- Model: [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts) — MIT, trained on public
  data. All the hard work is theirs.
- This harness: MIT (see [LICENSE](./LICENSE)).
