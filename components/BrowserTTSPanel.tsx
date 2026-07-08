"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorNote, Metric, Select } from "@/components/ui";

// Everything here runs 100% in the visitor's browser — no server CPU, nothing leaves the
// machine. Two engines: Kokoro-82M (ONNX/WASM via kokoro-js) and the OS's built-in voice.

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const SAMPLE =
  "This sentence is being synthesized entirely inside your browser — no server, no API, no keys.";

// Curated subset (full list via tts.list_voices()). Grades from the Kokoro model card.
const KOKORO_VOICES = [
  { value: "af_heart", label: "Heart · US ♀ (A)" },
  { value: "af_bella", label: "Bella · US ♀ (A-)" },
  { value: "af_nicole", label: "Nicole · US ♀ 🎧" },
  { value: "af_aoede", label: "Aoede · US ♀" },
  { value: "am_michael", label: "Michael · US ♂" },
  { value: "am_fenrir", label: "Fenrir · US ♂" },
  { value: "am_puck", label: "Puck · US ♂" },
  { value: "bf_emma", label: "Emma · UK ♀" },
  { value: "bm_george", label: "George · UK ♂" },
  { value: "bm_fable", label: "Fable · UK ♂" },
];

// dtype = the "version" switch: precision ↔ download size ↔ quality/speed.
const DTYPES = [
  { value: "q4", label: "q4 · ≈50 MB (fastest, lowest fidelity)" },
  { value: "q8", label: "q8 · ≈86 MB (balanced)" },
  { value: "fp16", label: "fp16 · ≈163 MB" },
  { value: "fp32", label: "fp32 · ≈326 MB (best, heaviest)" },
];

type Dtype = "q4" | "q8" | "fp16" | "fp32";
type Device = "wasm" | "webgpu";

type ProgressEvent = { status: string; file?: string; loaded?: number; total?: number };
type RawAudio = { audio: Float32Array; sampling_rate: number; toBlob: () => Blob };
type Kokoro = {
  generate: (text: string, opts: { voice: string }) => Promise<RawAudio>;
  list_voices?: () => unknown;
};

// cache one model instance per (dtype|device) so switching back is instant
const kokoroCache = new Map<string, Kokoro>();

export default function BrowserTTSPanel() {
  const [engine, setEngine] = useState<"kokoro" | "system">("kokoro");
  const [text, setText] = useState(SAMPLE);

  // kokoro controls
  const [dtype, setDtype] = useState<Dtype>("q8");
  const [device, setDevice] = useState<Device>("wasm");
  const [voice, setVoice] = useState("af_heart");
  const [webgpu, setWebgpu] = useState(false);

  // system-voice controls
  const [sysVoices, setSysVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [sysVoiceURI, setSysVoiceURI] = useState("");

  const [phase, setPhase] = useState<"" | "loading" | "generating">("");
  const [progress, setProgress] = useState<{ file: string; pct: number } | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    loadMs?: number;
    genMs?: number;
    durS?: number;
    rtf?: number;
    ttfaMs?: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const busy = phase !== "";

  const loadedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    setWebgpu(typeof navigator !== "undefined" && "gpu" in navigator);
  }, []);

  // OS voices load asynchronously
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const vs = window.speechSynthesis.getVoices();
      setSysVoices(vs);
      setSysVoiceURI((cur) => cur || vs.find((v) => v.default)?.voiceURI || vs[0]?.voiceURI || "");
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const deviceOptions = useMemo(
    () => [
      { value: "wasm", label: "WASM (CPU, works everywhere)" },
      ...(webgpu ? [{ value: "webgpu", label: "WebGPU (GPU-accelerated)" }] : []),
    ],
    [webgpu],
  );

  const genKokoro = async () => {
    setErr(null);
    setAudioUrl(null);
    setMetrics(null);
    try {
      const key = `${dtype}|${device}`;
      let loadMs = 0;
      let tts = kokoroCache.get(key);
      if (!tts) {
        setPhase("loading");
        setProgress({ file: "model", pct: 0 });
        const t0 = performance.now();
        const { KokoroTTS } = await import("kokoro-js");
        tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype,
          device,
          progress_callback: (p: ProgressEvent) => {
            if (p.status === "progress" && p.total) {
              setProgress({ file: p.file ?? "model", pct: Math.round(((p.loaded ?? 0) / p.total) * 100) });
            }
          },
        })) as Kokoro;
        kokoroCache.set(key, tts);
        loadedKeys.current.add(key);
        loadMs = performance.now() - t0;
      }
      setProgress(null);
      setPhase("generating");
      const tg = performance.now();
      const audio = await tts.generate(text, { voice });
      const genMs = performance.now() - tg;
      const durS = audio.audio.length / audio.sampling_rate;
      setAudioUrl(URL.createObjectURL(audio.toBlob()));
      setMetrics({ loadMs: loadMs || undefined, genMs, durS, rtf: durS / (genMs / 1000) });
    } catch (e) {
      setErr(`Kokoro failed: ${(e as Error).message}`);
    } finally {
      setPhase("");
      setProgress(null);
    }
  };

  const genSystem = () => {
    setErr(null);
    setAudioUrl(null);
    setMetrics(null);
    const synth = window.speechSynthesis;
    if (!synth) {
      setErr("This browser has no speechSynthesis API.");
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = sysVoices.find((x) => x.voiceURI === sysVoiceURI);
    if (v) u.voice = v;
    const t0 = performance.now();
    u.onstart = () => setMetrics({ ttfaMs: performance.now() - t0 });
    u.onerror = () => setErr("speechSynthesis error (some voices need a network fetch).");
    synth.speak(u);
  };

  const loaded = loadedKeys.current.has(`${dtype}|${device}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200/90">
        Runs <strong>100% in your browser</strong> — zero server CPU, nothing leaves your machine.
        Kokoro downloads the model once (cached by your browser), then generates offline.
      </div>

      {/* engine switch */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "kokoro", label: "Kokoro-82M (WASM)" },
            { id: "system", label: "System voice (OS)" },
          ] as const
        ).map((e) => (
          <button
            key={e.id}
            onClick={() => setEngine(e.id)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              engine === e.id
                ? "border-sky-500 bg-sky-500/10 text-neutral-100"
                : "border-neutral-700 bg-neutral-900/60 text-neutral-300 hover:border-neutral-500"
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-sm leading-relaxed text-neutral-100 outline-none focus:border-sky-500"
        placeholder="Type something to speak in your browser…"
      />

      {engine === "kokoro" ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Precision (version)"
              value={dtype}
              onChange={(v) => setDtype(v as Dtype)}
              options={DTYPES}
            />
            <Select
              label="Device"
              value={device}
              onChange={(v) => setDevice(v as Device)}
              options={deviceOptions}
            />
            <Select label="Voice" value={voice} onChange={setVoice} options={KOKORO_VOICES} />
            <Button onClick={genKokoro} disabled={busy || !text.trim()}>
              {phase === "loading"
                ? "Downloading model…"
                : phase === "generating"
                  ? "Generating…"
                  : loaded
                    ? "▶ Generate"
                    : "▶ Load & generate"}
            </Button>
          </div>
          <p className="text-xs text-neutral-500">
            The <strong>precision</strong> switch trades download size &amp; speed for fidelity;
            switching it (or the device) loads a different build once, then caches it. WebGPU pairs
            best with fp32. Model:{" "}
            <a
              className="text-sky-400 hover:underline"
              href="https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX"
              target="_blank"
              rel="noreferrer"
            >
              Kokoro-82M ONNX
            </a>{" "}
            (Apache-2.0).
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={`OS voice (${sysVoices.length} available)`}
            value={sysVoiceURI}
            onChange={setSysVoiceURI}
            options={sysVoices.map((v) => ({ value: v.voiceURI, label: `${v.name} — ${v.lang}` }))}
          />
          <Button onClick={genSystem} disabled={!text.trim() || sysVoices.length === 0}>
            ▶ Speak (OS)
          </Button>
          <p className="w-full text-xs text-neutral-500">
            Uses the browser’s built-in <span className="font-mono">speechSynthesis</span> — instant,
            no download, but quality/voices depend on your OS and some are cloud-backed.
          </p>
        </div>
      )}

      {progress && (
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <div className="h-1.5 flex-1 overflow-hidden rounded bg-neutral-800">
            <div className="h-full rounded bg-sky-500 transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
          <span className="tabular-nums">{progress.pct}% · {progress.file}</span>
        </div>
      )}

      {err && <ErrorNote>{err}</ErrorNote>}

      {audioUrl && <audio key={audioUrl} controls autoPlay src={audioUrl} className="w-full" />}

      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.rtf != null && <Metric label="RTF" value={metrics.rtf.toFixed(2)} unit="×" hint="audio ÷ generate" />}
          {metrics.genMs != null && <Metric label="generate" value={(metrics.genMs / 1000).toFixed(2)} unit="s" hint="in-browser" />}
          {metrics.durS != null && <Metric label="audio" value={metrics.durS.toFixed(2)} unit="s" />}
          {metrics.loadMs != null && <Metric label="model load" value={(metrics.loadMs / 1000).toFixed(1)} unit="s" hint="once per version" />}
          {metrics.ttfaMs != null && <Metric label="time to first audio" value={Math.round(metrics.ttfaMs)} unit="ms" hint="OS voice" />}
        </div>
      )}
    </div>
  );
}
