"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chat, streamSpeak, type ChatMsg, type Health, type Voices } from "@/lib/tts";
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
const sttLangFor = (language: string) => STT_LANG[language.replace(/_.*$/, "")] ?? "en-US";

// crude echo filter: is what the mic heard just the assistant's own voice bleeding back?
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const isEcho = (heard: string, assistantSaid: string) => {
  const h = norm(heard);
  const a = norm(assistantSaid);
  if (!h || !a) return false;
  if (a.includes(h)) return true;
  const hw = new Set(h.split(" "));
  const overlap = a.split(" ").filter((w) => hw.has(w)).length;
  return overlap / hw.size > 0.6; // most of the heard words are in what we just said
};

// map a latency (ms) to a green→amber→red colour: fast is green, slow is red.
const heat = (ms: number, good: number, bad: number) => {
  const f = Math.max(0, Math.min(1, (ms - good) / (bad - good)));
  const hue = 140 - 140 * f; // 140 green -> 0 red
  return `hsl(${Math.round(hue)} 75% 55%)`;
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

type Turn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  at: number; // ms since call start
  brain?: string;
  brainMs?: number;
  ttsFirstMs?: number;
  spokeMs?: number;
  respMs?: number; // you-finished-talking -> first audio out
  pending?: boolean;
  interrupted?: boolean; // you barged in before it finished speaking
};

type Mode = "idle" | "listening" | "thinking" | "speaking";

const MODE_META: Record<Mode, { label: string; color: string; verb: string }> = {
  idle: { label: "Ready to call", color: "#6b7280", verb: "idle" },
  listening: { label: "Listening", color: "#34d399", verb: "listening" },
  thinking: { label: "Thinking", color: "#fbbf24", verb: "thinking" },
  speaking: { label: "Speaking", color: "#38bdf8", verb: "speaking" },
};

export default function ConversePanel({
  voices,
  health,
  voice,
  setVoice,
  language,
  setLanguage,
  startNonce = 0,
}: {
  voices: Voices | null;
  health: Health | null;
  voice: string;
  setVoice: (v: string) => void;
  language: string;
  setLanguage: (l: string) => void;
  /** bump to auto-start a call from outside (e.g. the hero CTA) */
  startNonce?: number;
}) {
  const [supported, setSupported] = useState(true);
  const [mode, setMode] = useState<Mode>("idle");
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0); // drives live timers while a call is active

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const speakingRef = useRef(false); // assistant is currently speaking (for barge-in / echo filter)
  const startedAtRef = useRef(0);
  const opStartRef = useRef(0); // start of the in-progress response (for the live timer)
  const idRef = useRef(0);
  const genRef = useRef(0); // supersedes an in-flight turn when the user speaks again
  const speakAbortRef = useRef<AbortController | null>(null); // cut off the current TTS
  const lastAssistantRef = useRef(""); // last thing we said, for the echo filter
  const historyRef = useRef<ChatMsg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const voiceRef = useRef(voice);
  const languageRef = useRef(language);
  useEffect(() => void (voiceRef.current = voice), [voice]);
  useEffect(() => void (languageRef.current = language), [language]);

  useEffect(() => setSupported(getSRCtor() !== null), []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, interim]);

  // live tick (session clock + in-progress response timer) — only while active
  useEffect(() => {
    if (mode === "idle") return;
    const id = setInterval(() => setNowMs(performance.now()), 200);
    return () => clearInterval(id);
  }, [mode]);

  const active = mode !== "idle";
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
      const heard = finalText.trim();
      if (!heard) {
        setInterim(partial);
        return;
      }
      setInterim("");
      // ignore the assistant's own voice bleeding into the mic while it speaks
      if (speakingRef.current && isEcho(heard, lastAssistantRef.current)) return;
      void handleUtterance(heard); // real speech → new turn (barges in mid-reply)
    };
    rec.onerror = (ev) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted") setErr(`mic: ${ev.error}`);
    };
    rec.onend = () => {
      // keep recognition alive the whole call so the user can barge in at any moment
      if (activeRef.current) {
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
    if (!activeRef.current) return;
    const gen = ++genRef.current; // newer utterance supersedes any in-flight one
    speakAbortRef.current?.abort(); // barge-in: cut off the assistant mid-sentence
    speakingRef.current = false;
    setErr(null);

    const t0 = performance.now();
    opStartRef.current = t0;
    pushTurn({ role: "user", text });
    historyRef.current = [...historyRef.current, { role: "user", content: text }];

    setMode("thinking");
    const aid = pushTurn({ role: "assistant", text: "", pending: true });
    try {
      const tChat = performance.now();
      const { reply, brain } = await chat(historyRef.current);
      if (gen !== genRef.current) return; // superseded while waiting on the brain
      const brainMs = performance.now() - tChat; // real client round-trip to the brain
      patchTurn(aid, { text: reply, brain, brainMs: Math.round(brainMs), pending: false });
      historyRef.current = [...historyRef.current, { role: "assistant", content: reply }];
      lastAssistantRef.current = reply;

      setMode("speaking");
      speakingRef.current = true;
      const ac = new AbortController();
      speakAbortRef.current = ac;
      let firstMs = 0;
      const { totalMs, aborted } = await streamSpeak(
        { text: reply, voice: voiceRef.current, language: languageRef.current },
        (ms) => (firstMs = ms),
        ac.signal,
      );
      if (gen === genRef.current) {
        patchTurn(aid, {
          ttsFirstMs: firstMs ? Math.round(firstMs) : undefined,
          spokeMs: aborted ? undefined : Math.round(totalMs),
          respMs: firstMs ? Math.round(brainMs + firstMs) : undefined, // you stopped -> 1st audio
          interrupted: aborted || undefined,
        });
      }
    } catch (e) {
      if (gen === genRef.current) patchTurn(aid, { text: `⚠ ${(e as Error).message}`, pending: false });
    } finally {
      if (gen === genRef.current) {
        speakingRef.current = false;
        setMode(activeRef.current ? "listening" : "idle");
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
    setNowMs(performance.now());
    genRef.current++;
    activeRef.current = true;
    speakingRef.current = false;
    setMode("listening");
    startRec();
  };

  const stop = () => {
    genRef.current++; // invalidate any in-flight turn
    activeRef.current = false;
    speakingRef.current = false;
    speakAbortRef.current?.abort(); // stop any assistant audio immediately
    setInterim("");
    setMode("idle");
    try {
      recRef.current?.abort();
    } catch {
      /* noop */
    }
  };

  useEffect(() => () => stop(), []);

  // let the hero "Start a call" CTA kick off a call when we mount / re-trigger
  const didStartNonce = useRef(0);
  useEffect(() => {
    if (startNonce > 0 && startNonce !== didStartNonce.current) {
      didStartNonce.current = startNonce;
      if (!activeRef.current) start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNonce]);

  // derived session stats
  const userTurns = turns.filter((t) => t.role === "user").length;
  const responded = turns.filter((t) => t.role === "assistant" && t.respMs != null);
  const avgResp = responded.length
    ? Math.round(responded.reduce((s, t) => s + (t.respMs ?? 0), 0) / responded.length)
    : 0;
  const elapsed = active ? nowMs - startedAtRef.current : turns.length ? turns[turns.length - 1]!.at : 0;
  const liveOpMs =
    active && (mode === "thinking" || mode === "speaking") ? nowMs - opStartRef.current : 0;

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
      <CallHeader
        mode={mode}
        active={active}
        elapsed={elapsed}
        userTurns={userTurns}
        liveOpMs={liveOpMs}
        onStart={start}
        onStop={stop}
      />

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
      </div>

      <BrainBanner brain={health?.brain} />

      <p className="text-xs text-neutral-500">
        Mic → speech recognition (your browser; may use its cloud STT) → a brain replies →{" "}
        <strong>Pocket TTS speaks it locally</strong>. You can <strong>interrupt</strong> the
        assistant just by talking over it (barge-in). For the cleanest interruption use
        headphones, so the mic doesn’t hear the assistant’s own voice.
      </p>

      {err && <ErrorNote>{err}</ErrorNote>}

      {/* transcript / timeline */}
      <div
        ref={scrollRef}
        className={`relative max-h-[420px] min-h-[240px] overflow-y-auto rounded-lg border bg-neutral-950/60 p-4 transition-colors ${
          active ? "border-neutral-700" : "border-neutral-800"
        }`}
      >
        {active && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse"
            style={{ background: MODE_META[mode].color }}
          />
        )}
        {turns.length === 0 && !interim && (
          <div className="py-16 text-center text-sm text-neutral-600">
            {active ? "Listening… say something." : "Press “Start call” and say hello."}
          </div>
        )}
        <ol className="relative flex flex-col gap-4 border-l border-neutral-800 pl-4">
          {turns.map((t) => (
            <TurnRow key={t.id} turn={t} liveOpMs={t.pending ? liveOpMs : 0} />
          ))}
          {interim && (
            <li className="relative">
              <Dot style={{ background: "#34d399" }} pulse />
              <div className="text-sm italic text-neutral-400">{interim}…</div>
            </li>
          )}
        </ol>
      </div>

      {responded.length > 0 && (
        <SessionLedger
          turns={turns}
          userTurns={userTurns}
          avgResp={avgResp}
          totalMs={active ? elapsed : turns.length ? turns[turns.length - 1]!.at : 0}
        />
      )}
    </div>
  );
}

function BrainBanner({ brain }: { brain?: "xai" | "openai" | "local" }) {
  if (brain === undefined) return null;
  if (brain !== "local") {
    return (
      <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
        Real brain connected: <span className="font-mono">{brain}</span>. Replies are generated by
        a live LLM and spoken by Pocket TTS.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200">
      <strong>No LLM connected — replies are a scripted local demo.</strong> It can’t look things
      up, remember facts, or reason; it just keeps the voice loop going. Set{" "}
      <span className="font-mono">XAI_API_KEY</span> (Grok) or{" "}
      <span className="font-mono">OPENAI_API_KEY</span> in{" "}
      <span className="font-mono">.env.local</span> and restart the sidecar for real answers.
    </div>
  );
}

function CallHeader({
  mode,
  active,
  elapsed,
  userTurns,
  liveOpMs,
  onStart,
  onStop,
}: {
  mode: Mode;
  active: boolean;
  elapsed: number;
  userTurns: number;
  liveOpMs: number;
  onStart: () => void;
  onStop: () => void;
}) {
  const m = MODE_META[mode];
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 transition-colors ${
        active
          ? "border-transparent"
          : "border-neutral-800 bg-neutral-900/40"
      }`}
      style={active ? { background: `${m.color}14`, boxShadow: `0 0 0 1px ${m.color}55, 0 0 22px -6px ${m.color}` } : undefined}
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-3.5 w-3.5">
          {active && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
              style={{ background: m.color }}
            />
          )}
          <span
            className="relative inline-flex h-3.5 w-3.5 rounded-full"
            style={{ background: active ? m.color : "#4b5563" }}
          />
        </span>
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            {active && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-black"
                style={{ background: m.color }}
              >
                LIVE
              </span>
            )}
            {active ? `${m.label}…` : "Ready to call"}
          </div>
          <div className="text-xs tabular-nums text-neutral-400">
            {active
              ? liveOpMs > 0
                ? `${m.verb} · ${(liveOpMs / 1000).toFixed(1)}s`
                : "waiting for you"
              : "mic is off"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="font-mono text-xl leading-none tabular-nums text-neutral-100">
            {mmss(elapsed)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-neutral-500">
            {userTurns} turn{userTurns === 1 ? "" : "s"}
          </div>
        </div>
        {active ? (
          <button
            onClick={onStop}
            className="inline-flex items-center gap-2 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-400"
          >
            ■ End call
          </button>
        ) : (
          <Button onClick={onStart}>🎤 Start call</Button>
        )}
      </div>
    </div>
  );
}

function TurnRow({ turn: t, liveOpMs }: { turn: Turn; liveOpMs: number }) {
  const isUser = t.role === "user";
  const color = isUser ? "#34d399" : "#38bdf8";
  return (
    <li className="relative">
      <Dot style={{ background: color }} pulse={t.pending} />
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium" style={{ color }}>
          {isUser ? "you" : "assistant"}
        </span>
        <span className="text-[10px] tabular-nums text-neutral-600">{(t.at / 1000).toFixed(1)}s</span>
        {t.brain && <Chip>{t.brain}</Chip>}
        {t.interrupted && (
          <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">
            interrupted
          </span>
        )}
      </div>
      <div className={`mt-0.5 text-sm ${t.pending && !t.text ? "text-neutral-500" : "text-neutral-100"}`}>
        {t.text || (t.pending ? (liveOpMs > 0 ? `…thinking ${(liveOpMs / 1000).toFixed(1)}s` : "…") : "")}
      </div>
      {(t.respMs != null || t.brainMs != null || t.ttsFirstMs != null || t.spokeMs != null) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {t.respMs != null && <LatChip label="reply in" ms={t.respMs} good={600} bad={4000} secs />}
          {t.brainMs != null && <LatChip label="brain" ms={t.brainMs} good={150} bad={2000} />}
          {t.ttsFirstMs != null && <LatChip label="1st audio" ms={t.ttsFirstMs} good={200} bad={2500} />}
          {t.spokeMs != null && <LatChip label="spoke" ms={t.spokeMs} good={2000} bad={12000} secs />}
        </div>
      )}
    </li>
  );
}

function SessionLedger({
  turns,
  userTurns,
  avgResp,
  totalMs,
}: {
  turns: Turn[];
  userTurns: number;
  avgResp: number;
  totalMs: number;
}) {
  const responded = useMemo(
    () => turns.filter((t) => t.role === "assistant" && t.respMs != null),
    [turns],
  );
  const maxResp = Math.max(1, ...responded.map((t) => t.respMs ?? 0));
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Session log</span>
        <GradientLegend />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="call length" value={mmss(totalMs)} />
        <Stat label="turns" value={String(userTurns)} />
        <Stat label="avg reply" value={`${(avgResp / 1000).toFixed(1)}s`} color={heat(avgResp, 600, 4000)} />
      </div>
      {/* per-turn response-latency bars, coloured by how long the reply took */}
      <div className="mt-4 flex flex-col gap-1.5">
        {responded.map((t, i) => {
          const ms = t.respMs ?? 0;
          const c = heat(ms, 600, 4000);
          return (
            <div key={t.id} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-neutral-600">
                #{i + 1}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-800/60">
                <div
                  className="h-full rounded"
                  style={{ width: `${Math.max(4, (ms / maxResp) * 100)}%`, background: c }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-[10px] tabular-nums" style={{ color: c }}>
                {(ms / 1000).toFixed(1)}s
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GradientLegend() {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
      <span>fast</span>
      <span
        className="h-1.5 w-16 rounded"
        style={{ background: "linear-gradient(90deg, hsl(140 75% 55%), hsl(70 75% 55%), hsl(0 75% 55%))" }}
      />
      <span>slow</span>
    </div>
  );
}

function LatChip({
  label,
  ms,
  good,
  bad,
  secs,
}: {
  label: string;
  ms: number;
  good: number;
  bad: number;
  secs?: boolean;
}) {
  const c = heat(ms, good, bad);
  const val = secs ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded border bg-neutral-900/60 px-1.5 py-0.5 text-[10px] tabular-nums"
      style={{ borderColor: `${c}66`, color: c }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {label} {val}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums" style={{ color: color ?? "#f5f5f5" }}>
        {value}
      </div>
    </div>
  );
}

function Dot({ style, pulse }: { style: React.CSSProperties; pulse?: boolean }) {
  return (
    <span className="absolute -left-[21px] top-1 flex h-2.5 w-2.5">
      {pulse && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
          style={style}
        />
      )}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full ring-4 ring-neutral-950" style={style} />
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-400">
      {children}
    </span>
  );
}
