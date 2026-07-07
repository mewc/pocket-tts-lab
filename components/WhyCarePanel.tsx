"use client";

import { useState } from "react";
import type { Health } from "@/lib/tts";
import { Button, ErrorNote } from "@/components/ui";

type CloudResult = {
  provider: string;
  first_byte_ms: number;
  wall_ms: number;
  usd_per_1m_chars: number;
  cost_this_call_usd: number;
};

export default function WhyCarePanel({ health }: { health: Health | null }) {
  const [cloud, setCloud] = useState<CloudResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const race = async () => {
    setErr(null);
    setBusy(true);
    setCloud(null);
    try {
      const r = await fetch("/api/tts/compare/cloud", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "This is a quick round trip to a cloud text to speech API for comparison.",
          provider: "openai",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setCloud(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 text-sm leading-relaxed text-neutral-300">
      <Card title="It’s not an LLM — and that’s the point">
        <p>
          Typical “LLM TTS” autoregresses discrete audio tokens one step at a time until the
          model decides to stop — latency is variable and grows with a big transformer.
          Pocket TTS uses a compact flow-based model over the Mimi neural codec and emits audio
          in <strong>fixed 80 ms frames (12.5 Hz)</strong>. So the first frame arrives fast and
          the throughput (real-time factor) stays steady regardless of how the sentence ends.
          That’s why a <strong>100M-parameter</strong> model on a CPU can beat much larger
          cloud models on <em>latency</em>, even if not on raw naturalness.
        </p>
      </Card>

      <Card title="$0, offline, no GPU">
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-left">
            <thead className="bg-neutral-900/60 text-neutral-400">
              <tr>
                {["", "Pocket TTS (local)", "OpenAI tts-1", "ElevenLabs (Flash)"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-neutral-200">
              <Row k="Cost / 1M chars" a="$0" b="$15" c="~$50–100" />
              <Row k="Runs offline" a="yes" b="no" c="no" />
              <Row k="Needs GPU" a="no" b="—" c="—" />
              <Row k="Network round-trip" a="none" b="required" c="required" />
              <Row k="Data leaves machine" a="no" b="yes" c="yes" />
              <Row k="License" a="MIT (public data)" b="proprietary" c="proprietary" />
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Cloud prices are public list rates and move around; the point is the order of
          magnitude. Local marginal cost is genuinely zero after the one-time download.
        </p>
      </Card>

      <Card title="Measured on this machine">
        <p>
          {health ? (
            <>
              {health.cpu_count} CPU cores, torch pinned to {health.torch_threads} thread,{" "}
              {health.sample_rate / 1000} kHz output. Run the{" "}
              <strong>Benchmark</strong> tab to get live RTF / first-chunk numbers — on an Apple
              Silicon Mac this typically lands around <strong>6–8× real-time</strong> with a
              first chunk near <strong>~100 ms</strong>, i.e. it meets or beats the headline
              claims.
            </>
          ) : (
            "Waiting for the sidecar…"
          )}
        </p>
      </Card>

      <Card title="Optional: race a cloud API">
        <p className="mb-3">
          If <span className="font-mono">OPENAI_API_KEY</span> is set in{" "}
          <span className="font-mono">.env.local</span>, this makes one real round-trip to
          OpenAI tts-1 and shows its latency + cost. With no key it stays local-only.
        </p>
        <Button onClick={race} disabled={busy}>
          {busy ? "Racing…" : "Race OpenAI tts-1"}
        </Button>
        {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
        {cloud && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-neutral-200">
            <Fact k="provider" v={cloud.provider} />
            <Fact k="first byte" v={`${Math.round(cloud.first_byte_ms)} ms`} />
            <Fact k="wall time" v={`${(cloud.wall_ms / 1000).toFixed(2)} s`} />
            <Fact k="$/1M chars" v={`$${cloud.usd_per_1m_chars}`} />
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <h3 className="mb-2 text-base font-semibold text-neutral-100">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, a, b, c }: { k: string; a: string; b: string; c: string }) {
  return (
    <tr className="border-t border-neutral-800">
      <td className="px-3 py-1.5 text-neutral-400">{k}</td>
      <td className="px-3 py-1.5 text-emerald-300">{a}</td>
      <td className="px-3 py-1.5">{b}</td>
      <td className="px-3 py-1.5">{c}</td>
    </tr>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2">
      <div className="text-xs text-neutral-500">{k}</div>
      <div className="text-neutral-100">{v}</div>
    </div>
  );
}
