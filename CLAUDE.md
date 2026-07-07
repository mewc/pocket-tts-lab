# `apps/pocket-tts-lab` — Standalone Microproject

A test bench to run, feel, and **measure** Kyutai [Pocket TTS](https://github.com/kyutai-labs/pocket-tts)
(a 100M-param, CPU-only, MIT text-to-speech model) locally — and prove/disprove the
hype (6× real-time, ~200 ms first chunk, 5-second voice cloning, 6 languages, $0/offline).

## Boundary Rule (island)

Self-contained stack. Lives in the monorepo for convenience only; must be portable
out with zero refactoring.

- **Do not** import any `@grokx/*` package, share a DB, or read root `tsconfig`/`eslint`.
  Vendored local configs only. Own `bun.lock` (outside the root Bun workspace — the app is
  **not** listed in the root `package.json` `workspaces`).
- **Do** keep everything under `apps/pocket-tts-lab/`, including the Python sidecar.

## Two-process architecture

Pocket TTS is a **Python/PyTorch** package; this repo is Bun/Next.js. So the app is:

| Part            | Stack                        | Port | Location      |
| --------------- | ---------------------------- | ---- | ------------- |
| UI              | Next.js 16 + Tailwind v4     | 4703 | `app/`        |
| TTS sidecar     | FastAPI + `uv` + pocket-tts  | 4706 | `tts-server/` |

The browser only talks to Next; `app/api/tts/[...path]/route.ts` proxies to
`127.0.0.1:4706` (one origin, no CORS, streaming passes through).

## Local Development

Requires [`uv`](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`).

```bash
bun install                 # from this dir → own bun.lock
bun run tts:sync            # cd tts-server && uv sync  (installs CPU torch + pocket-tts)
bun run dev                 # boots BOTH the sidecar (4706) + Next (4703) → http://localhost:4703
```

- `bun run dev:web` / `bun run tts` run the two halves independently.
- **First model use downloads weights from HuggingFace** (~hundreds of MB) and is slow
  — expected, not a bug. Weights cache in `~/.cache/pocket_tts` and `~/.cache/huggingface`.
- Cloud comparison (`OPENAI_API_KEY` / `ELEVENLABS_API_KEY` in `.env.local`) is **optional**;
  the app is fully functional with zero keys.

## Real pocket-tts API (confirmed against the installed package)

- `TTSModel.load_model(language=...)` — **each language is a separate model/checkpoint**.
  Languages (config stems): `english` (default, = `english_2026-04`), `english_2026-01`,
  `french_24l`, `german`, `german_24l`, `italian`, `italian_24l`, `portuguese`,
  `portuguese_24l`, `spanish`, `spanish_24l`. `french` only exists as `french_24l`.
  → The sidecar lazy-loads + caches one model instance per language.
- `model.get_state_for_audio_prompt(voice)` — `voice` is either a **predefined name**
  (alba, michael, eve, george, jane, … — see `_ORIGINS_OF_PREDEFINED_VOICES`), a local
  audio path / `hf://` URL, or a `.safetensors` embedding. Predefined names load a
  per-language embedding safetensors; slow → cached per `(language, voice)`.
- `model.generate_audio(state, text)` → 1-D PCM tensor. `model.generate_audio_stream(...)`
  yields 1-D sample tensors (frame-by-frame). `model.sample_rate` (24 kHz).
- **NOT thread-safe** + `torch.set_num_threads(1)` at import → the sidecar serializes all
  generation behind a single `asyncio.Lock`.
- Voice **cloning from arbitrary audio** requires the gated voice-cloning weights; if they
  can't be downloaded the model runs with `has_voice_cloning = False` and only predefined
  voices / exported `.safetensors` work. The Clone tab surfaces this state.

## Converse demo (voice-agent loop)

The **Converse** tab is a live mic→reply→speak loop showing where Pocket TTS fits in a voice
agent, with a turn-by-turn timeline (latency chips per turn):

- **STT**: browser Web Speech API (`webkitSpeechRecognition`) — no key, live interim transcription.
  In Chrome this uses the browser's cloud STT (labeled honestly); the mic auto-pauses while the
  assistant speaks. Chrome/Edge only.
- **Brain** (`POST /chat`): prefers `XAI_API_KEY` (Grok), then `OPENAI_API_KEY`, else a small
  keyless **local demo brain** (`_local_reply`). Any LLM error falls back to local — loop never breaks.
- **Mouth**: Pocket TTS via `/speak/stream` — 100% local, the point of the demo.

## Captured result (first run, this repo)

On an Apple Silicon Mac (16 cores, torch pinned to **1 thread**, 24 kHz), English `alba`,
188-char paragraph, 5 timed runs after warm-up:

- **RTF mean 8.87×** (min 8.73, max 9.00) — vs the tweet's claimed 6×
- **TTFB p50 35 ms / p95 42 ms** — vs the claimed ~200 ms
- ~1.26 s wall to synthesize ~11 s of audio

i.e. it **beats the headline claims** on this machine, single-threaded. `has_voice_cloning`
was `false` (gated weights not downloaded), so the Clone tab shows the predefined-only notice.

## Benchmark honesty

`/benchmark` excludes a warm-up run, measures per-run time-to-first-frame + wall time +
audio duration, and returns machine facts (cpu_count, torch_threads). RTF = audio-seconds ÷
wall-seconds. Numbers are always measured, never hardcoded.
