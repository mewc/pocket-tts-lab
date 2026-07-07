"use client";

import { useState } from "react";
import { benchmark, type BenchResult, type Health, type Voices } from "@/lib/tts";
import BarChart from "@/components/BarChart";
import { Button, ErrorNote, Metric, Select } from "@/components/ui";

const PRESETS = {
  short: "Hello there. This is a quick test.",
  paragraph:
    "Pocket TTS is a hundred million parameter text to speech model that runs on the CPU. It bypasses the usual token transformer bottleneck, so it streams audio frame by frame at a fixed rate. That is why it reaches the first chunk quickly and keeps a steady real time factor.",
  long: "Text to speech used to mean a choice between quality and cost. Cloud APIs sound great but bill per character and need a network round trip. Local models were either bulky, GPU hungry, or robotic. A compact model that runs comfortably on a laptop CPU changes the trade off. You can generate speech offline, at zero marginal cost, with latency low enough for interactive use. The point of this benchmark is not to trust a tweet, but to measure the real numbers on this exact machine: how many seconds of audio it produces per second of wall clock time, and how long until the very first audio arrives.",
};

export default function BenchmarkPanel({
  voices,
  health,
}: {
  voices: Voices | null;
  health: Health | null;
}) {
  const [preset, setPreset] = useState<keyof typeof PRESETS>("paragraph");
  const [voice, setVoice] = useState("alba");
  const [language, setLanguage] = useState("english");
  const [runs, setRuns] = useState(5);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BenchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setErr(null);
    setBusy(true);
    setRes(null);
    try {
      setRes(await benchmark({ text: PRESETS[preset], voice, language, runs }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Text length"
          value={preset}
          onChange={(v) => setPreset(v as keyof typeof PRESETS)}
          options={(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => ({
            value: k,
            label: `${k} (${PRESETS[k].length} chars)`,
          }))}
        />
        <Select
          label="Language"
          value={language}
          onChange={setLanguage}
          options={(voices?.languages ?? ["english"]).map((l) => ({ value: l, label: l }))}
        />
        <Select
          label="Voice"
          value={voice}
          onChange={setVoice}
          options={(voices?.voices ?? ["alba"]).map((v) => ({ value: v, label: v }))}
        />
        <Select
          label="Runs"
          value={String(runs)}
          onChange={(v) => setRuns(Number(v))}
          options={[3, 5, 8, 10].map((n) => ({ value: String(n), label: String(n) }))}
        />
        <Button onClick={run} disabled={busy || !health?.warm}>
          {busy ? "Running…" : "Run benchmark"}
        </Button>
      </div>
      <p className="text-xs text-neutral-500">
        One warm-up run is discarded, then {runs} timed runs. RTF = seconds of audio produced
        per second of wall time. Kyutai claims ~6× real-time / ~200 ms first chunk on a Mac —
        the dashed lines mark those targets. Numbers are measured live on this machine.
      </p>

      {err && <ErrorNote>{err}</ErrorNote>}

      {res && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="RTF mean"
              value={res.aggregate.rtf_mean}
              unit="×"
              hint={`min ${res.aggregate.rtf_min} · max ${res.aggregate.rtf_max}`}
            />
            <Metric label="TTFB p50" value={res.aggregate.ttfb_p50_ms} unit="ms" />
            <Metric label="TTFB p95" value={res.aggregate.ttfb_p95_ms} unit="ms" />
            <Metric
              label="audio / run"
              value={(res.aggregate.audio_ms / 1000).toFixed(2)}
              unit="s"
              hint={`${res.aggregate.chars} chars`}
            />
          </div>

          <Section title={`Real-time factor per run (×)`}>
            <BarChart
              values={res.runs.map((r) => r.rtf)}
              unit="×"
              color="#34d399"
              refs={[
                { value: 1, label: "1× real-time", color: "#737373", dashed: true },
                { value: 6, label: "claimed 6×", color: "#fbbf24", dashed: true },
              ]}
            />
          </Section>

          <Section title="Time to first chunk per run (ms)">
            <BarChart
              values={res.runs.map((r) => r.first_chunk_ms)}
              unit=""
              color="#38bdf8"
              refs={[{ value: 200, label: "claimed 200ms", color: "#fbbf24", dashed: true }]}
            />
          </Section>

          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900/60 text-neutral-400">
                <tr>
                  {["#", "RTF ×", "first chunk ms", "wall ms", "audio ms", "chars/s"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums text-neutral-200">
                {res.runs.map((r, i) => (
                  <tr key={i} className="border-t border-neutral-800">
                    <td className="px-3 py-1.5 text-neutral-500">{i + 1}</td>
                    <td className="px-3 py-1.5">{r.rtf}</td>
                    <td className="px-3 py-1.5">{r.first_chunk_ms}</td>
                    <td className="px-3 py-1.5">{r.wall_ms}</td>
                    <td className="px-3 py-1.5">{r.audio_ms}</td>
                    <td className="px-3 py-1.5">{r.chars_per_s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-neutral-500">
            Machine: {res.machine.cpu_count} CPU cores, torch using{" "}
            {res.machine.torch_threads} thread(s), {res.machine.sample_rate / 1000} kHz output.
            pocket-tts pins <span className="font-mono">torch.set_num_threads(1)</span>, so this
            is a single-core result — it scales further with more threads.
          </p>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{title}</div>
      {children}
    </div>
  );
}
