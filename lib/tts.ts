// Typed client for the Pocket TTS sidecar (via the /api/tts proxy).

export type Health = {
  ok: boolean;
  model: string;
  sample_rate: number;
  torch_threads: number;
  cpu_count: number;
  has_voice_cloning: boolean | null;
  warm: boolean;
  languages: string[];
};

export type Voices = {
  languages: string[];
  default_language: string;
  voices: string[];
  suggested: string[];
  cloned: string[];
  has_voice_cloning: boolean | null;
};

export type SpeakMetrics = {
  wallMs: number;
  audioMs: number;
  firstChunkMs: number;
  rtf: number;
  charsPerS: number;
  sampleRate: number;
};

export type BenchRun = {
  first_chunk_ms: number;
  wall_ms: number;
  audio_ms: number;
  rtf: number;
  chars: number;
  chars_per_s: number;
};

export type BenchResult = {
  runs: BenchRun[];
  aggregate: {
    rtf_mean: number;
    rtf_min: number;
    rtf_max: number;
    ttfb_p50_ms: number;
    ttfb_p95_ms: number;
    wall_mean_ms: number;
    audio_ms: number;
    chars: number;
  };
  machine: {
    cpu_count: number;
    torch_threads: number;
    sample_rate: number;
    language: string;
    voice: string;
  };
};

const j = async (r: Response) => {
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data;
};

export const getHealth = () => fetch("/api/tts/health").then(j) as Promise<Health>;
export const getVoices = () => fetch("/api/tts/voices").then(j) as Promise<Voices>;

export async function speak(body: {
  text: string;
  voice: string;
  language: string;
}): Promise<{ url: string; metrics: SpeakMetrics }> {
  const r = await fetch("/api/tts/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  const h = r.headers;
  const metrics: SpeakMetrics = {
    wallMs: Number(h.get("X-Gen-Wall-Ms")),
    audioMs: Number(h.get("X-Audio-Dur-Ms")),
    firstChunkMs: Number(h.get("X-First-Chunk-Ms")),
    rtf: Number(h.get("X-RTF")),
    charsPerS: Number(h.get("X-Chars-Per-S")),
    sampleRate: Number(h.get("X-Sample-Rate")),
  };
  const url = URL.createObjectURL(await r.blob());
  return { url, metrics };
}

export const benchmark = (body: {
  text: string;
  voice: string;
  language: string;
  runs: number;
}) =>
  fetch("/api/tts/benchmark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(j) as Promise<BenchResult>;

export type ChatMsg = { role: "user" | "assistant"; content: string };

export const chat = (messages: ChatMsg[]) =>
  fetch("/api/tts/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  }).then(j) as Promise<{ reply: string; brain: string; brain_ms: number }>;

export async function clone(name: string, file: File): Promise<{ voice_id: string }> {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("file", file);
  return fetch("/api/tts/clone", { method: "POST", body: fd }).then(j);
}

/**
 * Stream int16 PCM frames from the sidecar and play them live via Web Audio.
 * Calls onFirstAudio(ms) the moment the first chunk arrives — this is the honest,
 * client-observed time-to-first-audio (the "~200ms" claim, measured end to end).
 * Returns when the whole utterance has finished playing.
 */
export async function streamSpeak(
  body: { text: string; voice: string; language: string },
  onFirstAudio?: (ms: number) => void,
): Promise<{ firstAudioMs: number; totalMs: number }> {
  const t0 = performance.now();
  const r = await fetch("/api/tts/speak/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) {
    throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  }
  const sampleRate = Number(r.headers.get("X-Sample-Rate")) || 24000;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC({ sampleRate });
  let playhead = ctx.currentTime;
  let firstAudioMs = 0;
  let leftover = new Uint8Array(0);

  const reader = r.body.getReader();
  const schedule = (bytes: Uint8Array) => {
    // combine with any odd leftover byte so int16 alignment holds
    let buf = bytes;
    if (leftover.length) {
      buf = new Uint8Array(leftover.length + bytes.length);
      buf.set(leftover);
      buf.set(bytes, leftover.length);
      leftover = new Uint8Array(0);
    }
    const usable = buf.length - (buf.length % 2);
    if (usable < buf.length) leftover = buf.slice(usable);
    if (usable === 0) return;
    const i16 = new Int16Array(buf.buffer, buf.byteOffset, usable / 2);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i]! / 32768;
    const ab = ctx.createBuffer(1, f32.length, sampleRate);
    ab.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, playhead);
    src.start(startAt);
    playhead = startAt + ab.duration;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      if (!firstAudioMs) {
        firstAudioMs = performance.now() - t0;
        onFirstAudio?.(firstAudioMs);
      }
      schedule(value);
    }
  }

  // wait until the last scheduled buffer has played out
  const remainingMs = Math.max(0, (playhead - ctx.currentTime) * 1000);
  await new Promise((res) => setTimeout(res, remainingMs + 50));
  await ctx.close();
  return { firstAudioMs, totalMs: performance.now() - t0 };
}
