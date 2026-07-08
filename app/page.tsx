"use client";

import { useEffect, useState } from "react";
import { getHealth, getVoices, type Health, type Voices } from "@/lib/tts";
import SynthesizePanel from "@/components/SynthesizePanel";
import BenchmarkPanel from "@/components/BenchmarkPanel";
import ClonePanel from "@/components/ClonePanel";
import ConversePanel from "@/components/ConversePanel";
import BrowserTTSPanel from "@/components/BrowserTTSPanel";
import RunModal from "@/components/RunModal";
import WhyCareModal from "@/components/WhyCareModal";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// where is THIS instance running — the user's machine or a hosted server?
function useRunLocation() {
  const [loc, setLoc] = useState<{ hosted: boolean; host: string } | null>(null);
  useEffect(() => {
    const h = window.location.hostname;
    const local =
      h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h.endsWith(".local");
    setLoc({ hosted: !local, host: window.location.host });
  }, []);
  return loc;
}

const TABS = [
  { id: "voice", label: "Pick a voice to talk to" },
  { id: "converse", label: "Converse" },
  { id: "benchmark", label: "Benchmark" },
  { id: "browser", label: "In your browser (WASM)" },
  { id: "clone", label: "Clone" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Page() {
  const [tab, setTab] = useState<Tab>("voice");
  const [health, setHealth] = useState<Health | null>(null);
  const [voices, setVoices] = useState<Voices | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // shared voice/language selection, surfaced in the hero and used by both demos
  const [voice, setVoice] = useState("alba");
  const [language, setLanguage] = useState("english");

  // nonces let the hero CTAs drive the panels below
  const [speakNonce, setSpeakNonce] = useState(0);
  const [callNonce, setCallNonce] = useState(0);

  const [showRun, setShowRun] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const runLoc = useRunLocation();

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

  const onSpeak = () => {
    setTab("voice");
    setSpeakNonce((n) => n + 1);
  };
  const onStartCall = () => {
    setTab("converse");
    setCallNonce((n) => n + 1);
  };

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      {/* hero */}
      <header className="mb-6 text-center sm:text-left">
        {/* top-right: compact status badge + run CTA */}
        <div className="mb-4 flex items-center justify-center gap-2 sm:justify-end">
          <StatusBadge health={health} err={err} runLoc={runLoc} />
          <button
            onClick={() => setShowRun(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900/60 px-3.5 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-sky-500/60 hover:bg-neutral-800 hover:text-white"
          >
            ▶ Run it yourself
          </button>
        </div>
        <h1 className="bg-gradient-to-br from-white to-neutral-400 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
          Talk to Pocket TTS
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-neutral-400 sm:mx-0">
          Kyutai{" "}
          <a
            className="text-sky-400 hover:underline"
            href="https://github.com/kyutai-labs/pocket-tts"
            target="_blank"
            rel="noreferrer"
          >
            pocket-tts
          </a>{" "}
          runs locally — no GPU, no API, no keys. Pick a voice and hear it synthesized on your
          CPU in milliseconds, or start a live voice call. Prove the claims yourself.
        </p>

        {/* primary CTAs */}
        <div className="mt-5 flex flex-wrap justify-center gap-3 sm:justify-start">
          <button
            onClick={onSpeak}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400"
          >
            🔊 Speak as {cap(voice)}
          </button>
          <button
            onClick={onStartCall}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/60 px-5 py-2.5 text-sm font-semibold text-neutral-100 transition-colors hover:border-neutral-500 hover:bg-neutral-800"
          >
            🎤 Start a call
          </button>
        </div>
      </header>

      {/* tab button group (segmented control) */}
      <nav className="flex flex-wrap gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900/40 p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-sky-500 text-white shadow-sm shadow-sky-500/20"
                : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* active panel, in a card connected to the button group above */}
      <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5 shadow-xl shadow-black/20 sm:p-6">
        {tab === "voice" && (
          <SynthesizePanel
            voices={voices}
            voice={voice}
            setVoice={setVoice}
            language={language}
            setLanguage={setLanguage}
            speakNonce={speakNonce}
          />
        )}
        {tab === "converse" && (
          <ConversePanel
            voices={voices}
            health={health}
            voice={voice}
            setVoice={setVoice}
            language={language}
            setLanguage={setLanguage}
            startNonce={callNonce}
          />
        )}
        {tab === "benchmark" && <BenchmarkPanel voices={voices} health={health} />}
        {tab === "browser" && <BrowserTTSPanel />}
        {tab === "clone" && <ClonePanel voices={voices} onCloned={() => void getVoices()} />}
      </div>

      {/* fixed bottom-right — opens the "why care" dialog */}
      <button
        onClick={() => setShowWhy(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900/90 px-4 py-2.5 text-sm font-medium text-neutral-100 shadow-2xl shadow-black/40 backdrop-blur transition-colors hover:border-sky-500/60 hover:bg-neutral-800"
      >
        💡 Why care?
      </button>

      <RunModal open={showRun} onClose={() => setShowRun(false)} />
      <WhyCareModal open={showWhy} onClose={() => setShowWhy(false)} health={health} />
    </main>
  );
}

type RunLoc = { hosted: boolean; host: string } | null;

function StatusBadge({
  health,
  err,
  runLoc,
}: {
  health: Health | null;
  err: string | null;
  runLoc: RunLoc;
}) {
  let dot = "bg-emerald-400";
  let label = "Warm";
  if (err) {
    dot = "bg-red-400";
    label = "Offline";
  } else if (!health) {
    dot = "bg-amber-400 animate-pulse";
    label = "Connecting…";
  } else if (!health.warm) {
    dot = "bg-amber-400 animate-pulse";
    label = "Warming…";
  }
  const cloningOff = !!health && !health.has_voice_cloning;

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900/60 py-1 pl-2.5 pr-1 text-xs">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="text-neutral-300">{label}</span>
      {health?.warm && runLoc && (
        <>
          <span className="h-3 w-px bg-neutral-700" />
          <span className={runLoc.hosted ? "text-sky-300" : "text-emerald-300"}>
            {runLoc.hosted ? "Hosted" : "Local"}
          </span>
        </>
      )}
      {cloningOff && (
        <span
          title="Voice cloning from your own audio needs Kyutai's gated weights — only the built-in voices work."
          className="text-amber-400"
        >
          ⚠
        </span>
      )}
      {health && <InfoPopover health={health} runLoc={runLoc} />}
    </div>
  );
}

function InfoPopover({ health, runLoc }: { health: Health; runLoc: RunLoc }) {
  return (
    <details className="group relative">
      <summary className="flex h-5 w-5 cursor-pointer list-none items-center justify-center rounded-full border border-neutral-700 text-[11px] font-semibold text-neutral-400 hover:border-neutral-500 hover:text-neutral-200">
        i
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-xs shadow-2xl">
        <div className="mb-2 text-[11px] uppercase tracking-wide text-neutral-500">Engine details</div>
        <InfoRow k="running on" v={runLoc?.hosted ? `hosted · ${runLoc.host}` : "your machine"} />
        <InfoRow k="sample rate" v={`${(health.sample_rate / 1000).toFixed(0)} kHz`} />
        <InfoRow k="cpu cores" v={String(health.cpu_count)} />
        <InfoRow k="torch threads" v={String(health.torch_threads)} />
        <InfoRow k="brain" v={health.brain} />
        <InfoRow
          k="voice cloning"
          v={health.has_voice_cloning ? "available" : "predefined only"}
          warn={!health.has_voice_cloning}
        />
      </div>
    </details>
  );
}

function InfoRow({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-neutral-500">{k}</span>
      <span className={warn ? "text-amber-300" : "text-neutral-200"}>{v}</span>
    </div>
  );
}
