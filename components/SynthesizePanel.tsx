"use client";

import { useMemo, useState } from "react";
import { speak, streamSpeak, type SpeakMetrics, type Voices } from "@/lib/tts";
import { Button, ErrorNote, Metric, Select } from "@/components/ui";

const SAMPLE =
  "Pocket TTS runs entirely on the CPU, and it is surprisingly fast. No GPU, no cloud, no API keys — just a hundred million parameters doing the work locally.";

export default function SynthesizePanel({ voices }: { voices: Voices | null }) {
  const [text, setText] = useState(SAMPLE);
  const [language, setLanguage] = useState("english");
  const [voice, setVoice] = useState("alba");
  const [busy, setBusy] = useState<"" | "speak" | "stream">("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SpeakMetrics | null>(null);
  const [streamMs, setStreamMs] = useState<{ first: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const voiceOptions = useMemo(() => {
    const base = voices?.voices ?? ["alba"];
    const cloned = (voices?.cloned ?? []).map((c) => `${c} (cloned)`);
    return [...cloned, ...base];
  }, [voices]);

  const cleanVoice = (v: string) => v.replace(/ \(cloned\)$/, "");

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

  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-100 outline-none focus:border-sky-500"
        placeholder="Type something to speak…"
      />

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Language (= model)"
          value={language}
          onChange={setLanguage}
          options={(voices?.languages ?? ["english"]).map((l) => ({ value: l, label: l }))}
        />
        <Select
          label="Voice"
          value={voice}
          onChange={setVoice}
          options={voiceOptions.map((v) => ({ value: v, label: v }))}
        />
        <div className="flex gap-2">
          <Button onClick={doSpeak} disabled={!!busy || !text.trim()}>
            {busy === "speak" ? "Generating…" : "Speak (full)"}
          </Button>
          <Button variant="ghost" onClick={doStream} disabled={!!busy || !text.trim()}>
            {busy === "stream" ? "Streaming…" : "Stream (live)"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        Switching language loads a different 100M model (slow the first time, cached after).
        “Stream” plays audio frame-by-frame via Web Audio to <em>feel</em> the low first-chunk
        latency; “Speak” returns the whole WAV and reports server-measured numbers.
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
