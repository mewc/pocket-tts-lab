"""
FastAPI measurement harness around Kyutai Pocket TTS (CPU-only).

Design constraints baked in from the real pocket_tts API:
- Each *language* is a separate model/checkpoint -> lazy-load + cache one per language.
- Model + voice-state loads are slow -> load once, cache voice states per (language, voice).
- pocket_tts is NOT thread-safe and sets torch.set_num_threads(1) at import -> every
  generation is serialized behind a single lock and run in a dedicated single worker thread
  so it never blocks the asyncio event loop.
- Numbers are always measured here, never hardcoded.

Run: uv run uvicorn server:app --host 127.0.0.1 --port 4706
"""

from __future__ import annotations

import asyncio
import io
import os
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Iterator

import numpy as np
import soundfile as sf
import torch
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

import pocket_tts
from pocket_tts import TTSModel, export_model_state
from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES

HERE = Path(__file__).parent
VOICES_DIR = HERE / "voices"
VOICES_DIR.mkdir(exist_ok=True)

CONFIG_DIR = Path(pocket_tts.__file__).parent / "config"
LANGUAGES = sorted(p.stem for p in CONFIG_DIR.glob("*.yaml"))
DEFAULT_LANGUAGE = "english"
PREDEFINED_VOICES = sorted(_ORIGINS_OF_PREDEFINED_VOICES.keys())

# A friendly default set that is known-good on the default English model.
DEFAULT_VOICES = [
    "alba", "michael", "eve", "george", "jane", "mary", "charles", "paul", "anna", "vera",
]

# --- serialized model access -------------------------------------------------

_models: dict[str, TTSModel] = {}
_voice_states: dict[tuple[str, str], dict] = {}
_gen_lock = asyncio.Lock()  # serialize ALL generation (pocket_tts is not thread-safe)
_load_lock = threading.Lock()  # guard lazy model loading


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Warm the default English model in the background so /health answers immediately
    # (warm=false) and the first real request is fast once warmup finishes.
    asyncio.create_task(asyncio.to_thread(lambda: _get_model(DEFAULT_LANGUAGE)))
    yield


app = FastAPI(title="pocket-tts-lab sidecar", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4703", "http://127.0.0.1:4703"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


def _get_model(language: str) -> TTSModel:
    if language not in LANGUAGES:
        raise HTTPException(400, f"Unknown language '{language}'. Options: {LANGUAGES}")
    with _load_lock:
        m = _models.get(language)
        if m is None:
            m = TTSModel.load_model(language=language)
            _models[language] = m
        return m


def _resolve_voice(model: TTSModel, language: str, voice: str) -> dict:
    """Return a (cached) model_state for a predefined name or a cloned .safetensors id."""
    key = (language, voice)
    st = _voice_states.get(key)
    if st is not None:
        return st
    cloned = VOICES_DIR / f"{voice}.safetensors"
    try:
        if cloned.exists():
            st = model.get_state_for_audio_prompt(cloned)
        else:
            st = model.get_state_for_audio_prompt(voice)
    except Exception as e:  # noqa: BLE001 - surface a clean message to the UI
        raise HTTPException(400, f"Could not load voice '{voice}' for '{language}': {e}")
    _voice_states[key] = st
    return st


def _stream_chunks(model: TTSModel, state: dict, text: str) -> Iterator[torch.Tensor]:
    return model.generate_audio_stream(state, text, copy_state=True)


# --- request models ----------------------------------------------------------

class SpeakReq(BaseModel):
    text: str
    voice: str = "alba"
    language: str = DEFAULT_LANGUAGE


class BenchReq(BaseModel):
    text: str
    voice: str = "alba"
    language: str = DEFAULT_LANGUAGE
    runs: int = 5


# --- generation primitives (run in a worker thread) --------------------------

def _generate_full(model: TTSModel, state: dict, text: str) -> tuple[np.ndarray, dict]:
    """Blocking. Returns (float32 mono samples, metrics)."""
    t0 = time.perf_counter()
    first = None
    chunks: list[torch.Tensor] = []
    for chunk in _stream_chunks(model, state, text):
        if first is None:
            first = time.perf_counter() - t0
        chunks.append(chunk.reshape(-1))
    wall = time.perf_counter() - t0
    audio = torch.cat(chunks).to(torch.float32).clamp(-1, 1).numpy() if chunks else np.zeros(0, np.float32)
    dur = len(audio) / model.sample_rate
    metrics = {
        "first_chunk_ms": round((first or 0) * 1000, 1),
        "wall_ms": round(wall * 1000, 1),
        "audio_ms": round(dur * 1000, 1),
        "rtf": round(dur / wall, 2) if wall > 0 else 0.0,
        "chars": len(text),
        "chars_per_s": round(len(text) / wall, 1) if wall > 0 else 0.0,
        "sample_rate": model.sample_rate,
    }
    return audio, metrics


async def _run(fn, *args):
    """Serialize + offload blocking generation to a thread (never blocks the loop)."""
    async with _gen_lock:
        return await asyncio.to_thread(fn, *args)


# --- endpoints ---------------------------------------------------------------

@app.get("/health")
async def health():
    default = _models.get(DEFAULT_LANGUAGE)
    return {
        "ok": True,
        "model": "kyutai/pocket-tts",
        "sample_rate": default.sample_rate if default else 24000,
        "torch_threads": torch.get_num_threads(),
        "cpu_count": os.cpu_count(),
        "has_voice_cloning": bool(getattr(default, "has_voice_cloning", False)) if default else None,
        "warm": DEFAULT_LANGUAGE in _models,
        "languages": LANGUAGES,
    }


@app.get("/voices")
async def voices():
    default = _models.get(DEFAULT_LANGUAGE)
    cloned = sorted(p.stem for p in VOICES_DIR.glob("*.safetensors"))
    return {
        "languages": LANGUAGES,
        "default_language": DEFAULT_LANGUAGE,
        "voices": PREDEFINED_VOICES,
        "suggested": DEFAULT_VOICES,
        "cloned": cloned,
        "has_voice_cloning": bool(getattr(default, "has_voice_cloning", False)) if default else None,
    }


@app.post("/speak")
async def speak(req: SpeakReq):
    if not req.text.strip():
        raise HTTPException(400, "text is empty")
    model = _get_model(req.language)
    state = _resolve_voice(model, req.language, req.voice)
    audio, metrics = await _run(_generate_full, model, state, req.text)
    buf = io.BytesIO()
    sf.write(buf, audio, model.sample_rate, format="WAV", subtype="PCM_16")
    return Response(
        content=buf.getvalue(),
        media_type="audio/wav",
        headers={
            "X-Gen-Wall-Ms": str(metrics["wall_ms"]),
            "X-Audio-Dur-Ms": str(metrics["audio_ms"]),
            "X-First-Chunk-Ms": str(metrics["first_chunk_ms"]),
            "X-RTF": str(metrics["rtf"]),
            "X-Chars-Per-S": str(metrics["chars_per_s"]),
            "X-Sample-Rate": str(metrics["sample_rate"]),
        },
    )


@app.post("/speak/stream")
async def speak_stream(req: SpeakReq):
    """Stream raw int16 mono PCM frames as they are decoded, for live Web Audio playback."""
    if not req.text.strip():
        raise HTTPException(400, "text is empty")
    model = _get_model(req.language)
    state = _resolve_voice(model, req.language, req.voice)

    q: queue.Queue = queue.Queue(maxsize=64)
    SENTINEL = object()

    def producer():
        try:
            for chunk in _stream_chunks(model, state, req.text):
                pcm = (chunk.reshape(-1).to(torch.float32).clamp(-1, 1) * 32767).to(torch.int16)
                q.put(pcm.numpy().tobytes())
        except Exception as e:  # noqa: BLE001
            q.put(("__error__", str(e)))
        finally:
            q.put(SENTINEL)

    async def body():
        async with _gen_lock:
            threading.Thread(target=producer, daemon=True).start()
            while True:
                item = await asyncio.to_thread(q.get)
                if item is SENTINEL:
                    break
                if isinstance(item, tuple):  # error
                    break
                yield item

    return StreamingResponse(
        body(),
        media_type="application/octet-stream",
        headers={"X-Sample-Rate": str(model.sample_rate), "X-PCM": "s16le-mono"},
    )


@app.post("/benchmark")
async def benchmark(req: BenchReq):
    if not req.text.strip():
        raise HTTPException(400, "text is empty")
    runs = max(1, min(req.runs, 20))
    model = _get_model(req.language)
    state = _resolve_voice(model, req.language, req.voice)

    # warm-up run (excluded) so the first-call caches don't skew results
    await _run(_generate_full, model, state, req.text)

    rows = []
    for _ in range(runs):
        _, m = await _run(_generate_full, model, state, req.text)
        rows.append(m)

    def pct(vals, p):
        s = sorted(vals)
        i = min(len(s) - 1, int(round((p / 100) * (len(s) - 1))))
        return s[i]

    rtfs = [r["rtf"] for r in rows]
    ttfbs = [r["first_chunk_ms"] for r in rows]
    walls = [r["wall_ms"] for r in rows]
    return {
        "runs": rows,
        "aggregate": {
            "rtf_mean": round(sum(rtfs) / len(rtfs), 2),
            "rtf_min": min(rtfs),
            "rtf_max": max(rtfs),
            "ttfb_p50_ms": pct(ttfbs, 50),
            "ttfb_p95_ms": pct(ttfbs, 95),
            "wall_mean_ms": round(sum(walls) / len(walls), 1),
            "audio_ms": rows[0]["audio_ms"],
            "chars": rows[0]["chars"],
        },
        "machine": {
            "cpu_count": os.cpu_count(),
            "torch_threads": torch.get_num_threads(),
            "sample_rate": model.sample_rate,
            "language": req.language,
            "voice": req.voice,
        },
    }


@app.post("/clone")
async def clone(name: str = Form(...), file: UploadFile = File(...)):
    model = _get_model(DEFAULT_LANGUAGE)
    if not getattr(model, "has_voice_cloning", False):
        raise HTTPException(
            409,
            "Voice cloning from arbitrary audio is unavailable: the gated Pocket TTS "
            "voice-cloning weights were not downloaded. Predefined voices and exported "
            ".safetensors embeddings still work.",
        )
    safe = "".join(c for c in name if c.isalnum() or c in "-_") or f"voice-{uuid.uuid4().hex[:8]}"
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    tmp = VOICES_DIR / f"_{uuid.uuid4().hex}{suffix}"
    tmp.write_bytes(await file.read())
    try:
        state = await asyncio.to_thread(model.get_state_for_audio_prompt, tmp)
        out = VOICES_DIR / f"{safe}.safetensors"
        export_model_state(state, str(out))
        _voice_states[(DEFAULT_LANGUAGE, safe)] = state
    finally:
        tmp.unlink(missing_ok=True)
    return {"voice_id": safe, "language": DEFAULT_LANGUAGE}


class CloudReq(BaseModel):
    text: str
    provider: str = "openai"


@app.post("/compare/cloud")
async def compare_cloud(req: CloudReq):
    import httpx

    if req.provider == "openai":
        key = os.getenv("OPENAI_API_KEY")
        if not key:
            raise HTTPException(400, "OPENAI_API_KEY not set")
        t0 = time.perf_counter()
        first = None
        total = 0
        async with httpx.AsyncClient(timeout=60) as c:
            async with c.stream(
                "POST",
                "https://api.openai.com/v1/audio/speech",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": "tts-1", "voice": "alloy", "input": req.text, "response_format": "mp3"},
            ) as r:
                r.raise_for_status()
                async for b in r.aiter_bytes():
                    if first is None:
                        first = time.perf_counter() - t0
                    total += len(b)
        wall = time.perf_counter() - t0
        # OpenAI tts-1 public rate: $15 / 1M characters.
        return {
            "provider": "openai:tts-1",
            "first_byte_ms": round((first or 0) * 1000, 1),
            "wall_ms": round(wall * 1000, 1),
            "bytes": total,
            "usd_per_1m_chars": 15.0,
            "cost_this_call_usd": round(len(req.text) / 1_000_000 * 15.0, 6),
            "offline": False,
        }
    raise HTTPException(400, f"Unknown provider '{req.provider}'")


@app.exception_handler(HTTPException)
async def _http_exc(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
