"use client";

import { useEffect, useState } from "react";
import { getHealth, getVoices, type Health, type Voices } from "@/lib/tts";
import SynthesizePanel from "@/components/SynthesizePanel";
import BenchmarkPanel from "@/components/BenchmarkPanel";
import ClonePanel from "@/components/ClonePanel";
import WhyCarePanel from "@/components/WhyCarePanel";

const TABS = ["Synthesize", "Benchmark", "Clone", "Why care"] as const;
type Tab = (typeof TABS)[number];

export default function Page() {
  const [tab, setTab] = useState<Tab>("Synthesize");
  const [health, setHealth] = useState<Health | null>(null);
  const [voices, setVoices] = useState<Voices | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [h, v] = await Promise.all([getHealth(), getVoices()]);
        if (!alive) return;
        setHealth(h);
        setVoices(v);
        setErr(null);
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Pocket TTS Lab <span className="text-neutral-500">·</span>{" "}
          <span className="text-neutral-400 text-base font-normal">
            100M-param CPU text-to-speech, measured
          </span>
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Kyutai{" "}
          <a
            className="text-sky-400 hover:underline"
            href="https://github.com/kyutai-labs/pocket-tts"
            target="_blank"
            rel="noreferrer"
          >
            pocket-tts
          </a>{" "}
          running locally — no GPU, no API, no keys. Prove the claims yourself.
        </p>
      </header>

      <StatusBar health={health} err={err} />

      <nav className="mt-6 flex gap-1 border-b border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === t
                ? "border-b-2 border-sky-400 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "Synthesize" && <SynthesizePanel voices={voices} />}
        {tab === "Benchmark" && <BenchmarkPanel voices={voices} health={health} />}
        {tab === "Clone" && <ClonePanel voices={voices} onCloned={() => void getVoices()} />}
        {tab === "Why care" && <WhyCarePanel health={health} />}
      </div>
    </main>
  );
}

function StatusBar({ health, err }: { health: Health | null; err: string | null }) {
  if (err) {
    return (
      <div className="rounded-lg border border-amber-900/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
        Sidecar not reachable yet: <span className="font-mono">{err}</span>
        <div className="mt-1 text-amber-300/70">
          First run downloads model weights from HuggingFace (slow, ~once). Start it with{" "}
          <span className="font-mono">bun run dev</span>.
        </div>
      </div>
    );
  }
  if (!health) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-400">
        Connecting to the TTS sidecar…
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm">
      <Dot ok={health.warm} />
      <span className="text-neutral-300">
        {health.warm ? "Model warm" : "Warming up model…"}
      </span>
      <Stat k="sample rate" v={`${(health.sample_rate / 1000).toFixed(0)} kHz`} />
      <Stat k="cpu cores" v={String(health.cpu_count)} />
      <Stat k="torch threads" v={String(health.torch_threads)} />
      <Stat
        k="voice cloning"
        v={health.has_voice_cloning ? "available" : "predefined only"}
      />
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        ok ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
      }`}
    />
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span className="text-neutral-400">
      {k}: <span className="text-neutral-200">{v}</span>
    </span>
  );
}
