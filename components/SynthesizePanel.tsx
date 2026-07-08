"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { speak, streamSpeak, type SpeakMetrics, type Voices } from "@/lib/tts";
import { Button, ErrorNote, Metric, Select } from "@/components/ui";

const SAMPLE =
  "Pocket TTS runs entirely on the CPU, and it is surprisingly fast. No GPU, no cloud, no API keys — just a hundred million parameters doing the work locally.";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// deterministic hue per voice name so each persona gets its own avatar color
const hue = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

const greeting = (name: string) =>
  `Hi, I'm ${cap(name)}. This is what I sound like, running entirely on your CPU.`;

export default function SynthesizePanel({
  voices,
  voice,
  setVoice,
  language,
  setLanguage,
  speakNonce = 0,
}: {
  voices: Voices | null;
  voice: string;
  setVoice: (v: string) => void;
  language: string;
  setLanguage: (l: string) => void;
  /** bump to trigger a Speak from outside (e.g. the hero CTA) */
  speakNonce?: number;
}) {
  const [text, setText] = useState(SAMPLE);
  const [busy, setBusy] = useState<"" | "speak" | "stream" | "sample">("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SpeakMetrics | null>(null);
  const [streamMs, setStreamMs] = useState<{ first: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const cleanVoice = (v: string) => v.replace(/ \(cloned\)$/, "");

  const { primaryChips, extraChips, allCount } = useMemo(() => {
    const cloned = voices?.cloned ?? [];
    const suggested = voices?.suggested ?? ["alba", "michael", "eve", "george", "jane"];
    const all = voices?.voices ?? suggested;
    return {
      // chips shown up top: cloned voices first, then the friendly suggested set
      primaryChips: [...cloned.map((c) => `${c} (cloned)`), ...suggested],
      // everything else, revealed by "show all"
      extraChips: all.filter((v) => !suggested.includes(v)),
      allCount: all.length,
    };
  }, [voices]);

  const doSpeak = async () => {
    setErr(null);
    setBusy("speak");
    setStreamMs(null);
    try {
      const { url, metrics } = await speak({ text, voice: cleanVoice(voice), language });
      setAudioUrl(url);
      setMetrics(metrics);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const doStream = async () => {
    setErr(null);
    setBusy("stream");
    setStreamMs(null);
    try {
      const { firstAudioMs, totalMs } = await streamSpeak({
        text,
        voice: cleanVoice(voice),
        language,
      });
      setStreamMs({ first: firstAudioMs, total: totalMs });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  // let an external CTA (the hero "Speak as …" button) fire a Speak
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (text.trim()) void doSpeak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakNonce]);

  // one-tap "hear this voice" — speaks a short greeting so you can meet each persona
  const hearVoice = async (v: string) => {
    setErr(null);
    setBusy("sample");
    setStreamMs(null);
    setMetrics(null);
    try {
      const clean = cleanVoice(v);
      const { url } = await speak({ text: greeting(clean), voice: clean, language });
      setAudioUrl(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* voice picker — the personas you can talk to */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <label className="text-sm font-medium text-neutral-300">Pick a voice to talk to</label>
          {extraChips.length > 0 && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              {showAll ? "Show fewer" : `Show all ${allCount}`}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {primaryChips.map((v) => (
            <VoiceChip
              key={v}
              name={v}
              selected={voice === v}
              busy={busy === "sample" && voice === v}
              onSelect={() => setVoice(v)}
              onHear={() => {
                setVoice(v);
                void hearVoice(v);
              }}
            />
          ))}
        </div>
        {showAll && extraChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {extraChips.map((v) => (
              <button
                key={v}
                onClick={() => setVoice(v)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  voice === v
                    ? "bg-sky-500 text-white"
                    : "bg-neutral-800/70 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {cap(v)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* what they should say */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-xl border border-neutral-700 bg-neutral-900 p-4 text-sm leading-relaxed text-neutral-100 outline-none focus:border-sky-500"
        placeholder="Type what you want them to say…"
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Language (= model)"
          value={language}
          onChange={setLanguage}
          options={(voices?.languages ?? ["english"]).map((l) => ({ value: l, label: cap(l) }))}
        />
        <div className="flex flex-1 gap-2">
          <Button onClick={doSpeak} disabled={!!busy || !text.trim()}>
            {busy === "speak" ? "Generating…" : `▶ Speak as ${cap(cleanVoice(voice))}`}
          </Button>
          <Button variant="ghost" onClick={doStream} disabled={!!busy || !text.trim()}>
            {busy === "stream" ? "Streaming…" : "Stream live"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        Tap a voice’s <strong>play</strong> icon to hear it say hello. Switching language loads a
        different 100M model (slow the first time, cached after). <em>Stream</em> plays audio
        frame-by-frame via Web Audio so you can feel the low first-chunk latency; <em>Speak</em>{" "}
        returns the whole clip with server-measured numbers.
      </p>

      {err && <ErrorNote>{err}</ErrorNote>}

      {audioUrl && (
        <audio key={audioUrl} controls autoPlay src={audioUrl} className="w-full" />
      )}

      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="RTF" value={metrics.rtf} unit="×" hint="audio ÷ wall time" />
          <Metric label="first chunk" value={metrics.firstChunkMs} unit="ms" hint="server-side" />
          <Metric label="wall time" value={(metrics.wallMs / 1000).toFixed(2)} unit="s" />
          <Metric label="audio" value={(metrics.audioMs / 1000).toFixed(2)} unit="s" />
        </div>
      )}

      {streamMs && (
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label="time to first audio"
            value={Math.round(streamMs.first)}
            unit="ms"
            hint="client-observed (fetch → speaker)"
          />
          <Metric
            label="stream wall time"
            value={(streamMs.total / 1000).toFixed(2)}
            unit="s"
          />
        </div>
      )}
    </div>
  );
}

function VoiceChip({
  name,
  selected,
  busy,
  onSelect,
  onHear,
}: {
  name: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onHear: () => void;
}) {
  const clean = name.replace(/ \(cloned\)$/, "");
  const isCloned = name.endsWith("(cloned)");
  const h = hue(clean);
  return (
    <div
      className={`group flex items-center gap-2 rounded-full border py-1 pl-1 pr-1.5 transition-colors ${
        selected
          ? "border-sky-500 bg-sky-500/10"
          : "border-neutral-700 bg-neutral-900/60 hover:border-neutral-500"
      }`}
    >
      <button
        onClick={onSelect}
        className="flex items-center gap-2"
        title={`Select ${clean}`}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{
            background: `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 40) % 360} 70% 35%))`,
          }}
        >
          {clean.charAt(0).toUpperCase()}
        </span>
        <span className={`text-sm ${selected ? "text-neutral-100" : "text-neutral-300"}`}>
          {clean.charAt(0).toUpperCase() + clean.slice(1)}
          {isCloned && <span className="ml-1 text-xs text-emerald-400">·cloned</span>}
        </span>
      </button>
      <button
        onClick={onHear}
        disabled={busy}
        title={`Hear ${clean} say hello`}
        className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-50"
      >
        {busy ? (
          <span className="h-3 w-3 animate-spin rounded-full border border-neutral-400 border-t-transparent" />
        ) : (
          <span className="text-[10px]">▶</span>
        )}
      </button>
    </div>
  );
}
