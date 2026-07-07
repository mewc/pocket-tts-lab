"use client";

import { useEffect, useRef, useState } from "react";
import { chat, streamSpeak, type ChatMsg, type Voices } from "@/lib/tts";
import { Button, ErrorNote, Select } from "@/components/ui";

// --- minimal Web Speech API typings (not in the standard lib) ----------------
type SRAlt = { transcript: string; confidence: number };
type SRResult = { readonly length: number; isFinal: boolean; [i: number]: SRAlt };
type SRResultList = { readonly length: number; [i: number]: SRResult };
type SREvent = { resultIndex: number; results: SRResultList };
type SRErr = { error: string };
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErr) => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

const getSRCtor = (): SRCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// language (= model) -> BCP-47 tag for the recognizer
const STT_LANG: Record<string, string> = {
  english: "en-US",
  french: "fr-FR",
  german: "de-DE",
  italian: "it-IT",
  portuguese: "pt-PT",
  spanish: "es-ES",
};
const sttLangFor = (language: string) =>
  STT_LANG[language.replace(/_.*$/, "")] ?? "en-US";

type Turn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  at: number; // ms since conversation start
  brain?: string;
  brainMs?: number;
  ttsFirstMs?: number;
  spokeMs?: number;
  pending?: boolean;
};

type Mode = "idle" | "listening" | "thinking" | "speaking";

export default function ConversePanel({ voices }: { voices: Voices | null }) {
  const [supported, setSupported] = useState(true);
  const [mode, setMode] = useState<Mode>("idle");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voice, setVoice] = useState("alba");
  const [language, setLanguage] = useState("english");
  const [err, setErr] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false); // conversation running?
  const busyRef = useRef(false); // thinking/speaking — mic paused
  const startedAtRef = useRef(0);
  const idRef = useRef(0);
  const historyRef = useRef<ChatMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // live mirrors so async callbacks read current pickers
  const voiceRef = useRef(voice);
  const languageRef = useRef(language);
  useEffect(() => void (voiceRef.current = voice), [voice]);
  useEffect(() => void (languageRef.current = language), [language]);

  useEffect(() => setSupported(getSRCtor() !== null), []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, interim]);

  const now = () => performance.now() - startedAtRef.current;

  const pushTurn = (t: Omit<Turn, "id" | "at">) => {
    const id = ++idRef.current;
    setTurns((prev) => [...prev, { ...t, id, at: now() }]);
    return id;
  };
  const patchTurn = (id: number, patch: Partial<Turn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const startRec = () => {
    const Ctor = getSRCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = sttLangFor(languageRef.current);
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = "";
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const alt = r[0];
        if (!alt) continue;
        if (r.isFinal) finalText += alt.transcript;
        else partial += alt.transcript;
      }
      setInterim(partial);
      if (finalText.trim()) {
        setInterim("");
        void handleUtterance(finalText.trim());
      }
    };
    rec.onerror = (ev) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted") setErr(`mic: ${ev.error}`);
    };
    rec.onend = () => {
      // Chrome ends recognition periodically; resume if we're still listening.
      if (activeRef.current && !busyRef.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  };

  const handleUtterance = async (text: string) => {
    if (!activeRef.current || busyRef.current) return;
    busyRef.current = true;
    setErr(null);
    recRef.current?.stop(); // pause mic so it doesn't hear the reply

    pushTurn({ role: "user", text });
    historyRef.current = [...historyRef.current, { role: "user", content: text }];

    setMode("thinking");
    const aid = pushTurn({ role: "assistant", text: "…", pending: true });
    try {
      const { reply, brain, brain_ms } = await chat(historyRef.current);
      patchTurn(aid, { text: reply, brain, brainMs: brain_ms, pending: false });
      historyRef.current = [...historyRef.current, { role: "assistant", content: reply }];

      setMode("speaking");
      let firstMs = 0;
      const { totalMs } = await streamSpeak(
        { text: reply, voice: voiceRef.current, language: languageRef.current },
        (ms) => (firstMs = ms),
      );
      patchTurn(aid, { ttsFirstMs: Math.round(firstMs), spokeMs: Math.round(totalMs) });
    } catch (e) {
      patchTurn(aid, { text: `⚠ ${(e as Error).message}`, pending: false });
    } finally {
      busyRef.current = false;
      if (activeRef.current) {
        setMode("listening");
        startRec(); // resume listening for the next turn
      } else {
        setMode("idle");
      }
    }
  };

  const start = () => {
    if (!getSRCtor()) {
      setSupported(false);
      return;
    }
    setErr(null);
    setTurns([]);
    historyRef.current = [];
    startedAtRef.current = performance.now();
    activeRef.current = true;
    busyRef.current = false;
    setMode("listening");
    startRec();
  };

  const stop = () => {
    activeRef.current = false;
    busyRef.current = false;
    setInterim("");
    setMode("idle");
    try {
      recRef.current?.abort();
    } catch {
      /* noop */
    }
  };

  useEffect(() => () => stop(), []); // cleanup on unmount

  if (!supported) {
    return (
      <ErrorNote>
        This browser has no Web Speech API (speech recognition). Use Chrome or Edge for the
        Converse demo. The other tabs work everywhere.
      </ErrorNote>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Assistant language"
          value={language}
          onChange={setLanguage}
          options={(voices?.languages ?? ["english"]).map((l) => ({ value: l, label: l }))}
        />
        <Select
          label="Assistant voice"
          value={voice}
          onChange={setVoice}
          options={(voices?.voices ?? ["alba"]).map((v) => ({ value: v, label: v }))}
        />
        {mode === "idle" ? (
          <Button onClick={start}>🎤 Start conversation</Button>
        ) : (
          <Button variant="ghost" onClick={stop}>
            ■ Stop
          </Button>
        )}
        <StatusPill mode={mode} />
      </div>

      <p className="text-xs text-neutral-500">
        Mic → speech recognition (your browser; may use its cloud STT) → a brain replies →{" "}
        <strong>Pocket TTS speaks it locally</strong>. Set <span className="font-mono">XAI_API_KEY</span>{" "}
        or <span className="font-mono">OPENAI_API_KEY</span> for a real LLM; otherwise a small
        local demo brain answers. The mic pauses while the assistant is speaking.
      </p>

      {err && <ErrorNote>{err}</ErrorNote>}

      <div
        ref={scrollRef}
        className="max-h-[420px] min-h-[220px] overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-4"
      >
        {turns.length === 0 && !interim && (
          <div className="py-16 text-center text-sm text-neutral-600">
            {mode === "idle"
              ? "Press Start and say hello."
              : "Listening… say something."}
          </div>
        )}
        <ol className="relative flex flex-col gap-4 border-l border-neutral-800 pl-4">
          {turns.map((t) => (
            <TurnRow key={t.id} turn={t} />
          ))}
          {interim && (
            <li className="relative">
              <Dot className="bg-sky-500/60" />
              <div className="text-sm italic text-neutral-500">{interim}…</div>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}

function TurnRow({ turn: t }: { turn: Turn }) {
  const isUser = t.role === "user";
  return (
    <li className="relative">
      <Dot className={isUser ? "bg-emerald-400" : "bg-sky-400"} />
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-medium ${isUser ? "text-emerald-400" : "text-sky-400"}`}>
          {isUser ? "you" : "assistant"}
        </span>
        <span className="text-[10px] tabular-nums text-neutral-600">
          {(t.at / 1000).toFixed(1)}s
        </span>
        {t.brain && <Chip>{t.brain}</Chip>}
      </div>
      <div className={`mt-0.5 text-sm ${t.pending ? "text-neutral-500" : "text-neutral-100"}`}>
        {t.text}
      </div>
      {(t.brainMs || t.ttsFirstMs || t.spokeMs) && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {t.brainMs != null && <Chip>brain {Math.round(t.brainMs)}ms</Chip>}
          {t.ttsFirstMs != null && <Chip>1st audio {t.ttsFirstMs}ms</Chip>}
          {t.spokeMs != null && <Chip>spoke {(t.spokeMs / 1000).toFixed(1)}s</Chip>}
        </div>
      )}
    </li>
  );
}

function Dot({ className }: { className: string }) {
  return (
    <span
      className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-neutral-950 ${className}`}
    />
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-400">
      {children}
    </span>
  );
}

function StatusPill({ mode }: { mode: Mode }) {
  const map: Record<Mode, { label: string; cls: string }> = {
    idle: { label: "idle", cls: "text-neutral-500" },
    listening: { label: "● listening", cls: "text-emerald-400 animate-pulse" },
    thinking: { label: "◐ thinking", cls: "text-amber-400" },
    speaking: { label: "🔊 speaking", cls: "text-sky-400" },
  };
  const s = map[mode];
  return <span className={`text-sm ${s.cls}`}>{s.label}</span>;
}
