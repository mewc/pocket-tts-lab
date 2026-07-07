"use client";

import { useRef, useState } from "react";
import { clone, speak, type Voices } from "@/lib/tts";
import { Button, ErrorNote, Metric } from "@/components/ui";

export default function ClonePanel({
  voices,
  onCloned,
}: {
  voices: Voices | null;
  onCloned: () => void;
}) {
  const [name, setName] = useState("myvoice");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clonedId, setClonedId] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const cloningOff = voices?.has_voice_cloning === false;

  const record = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        const ext = rec.mimeType.includes("ogg") ? "ogg" : "webm";
        setFile(new File([blob], `recording.${ext}`, { type: rec.mimeType }));
        stream.getTracks().forEach((t) => t.stop());
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setTimeout(() => {
        if (rec.state !== "inactive") rec.stop();
        setRecording(false);
      }, 6000);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doClone = async () => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    setTestUrl(null);
    try {
      const { voice_id } = await clone(name, file);
      setClonedId(voice_id);
      onCloned();
      const { url } = await speak({
        text: "This is my cloned voice, generated locally by Pocket TTS.",
        voice: voice_id,
        language: "english",
      });
      setTestUrl(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {cloningOff && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          <strong>Cloning from arbitrary audio is gated.</strong> The Pocket TTS
          voice-cloning weights weren’t downloaded (they require accepting the model license
          on HuggingFace), so this model runs in <em>predefined-voices-only</em> mode. You can
          still try below — the backend will explain if it can’t. To enable it, authenticate
          with <span className="font-mono">huggingface-cli login</span> and accept the model
          terms, then restart the sidecar.
        </div>
      )}

      <p className="text-sm text-neutral-400">
        Voice cloning claim: usable from just ~5 seconds of clean audio. Record a short clip or
        upload a WAV/MP3, then Pocket TTS extracts a speaker embedding and speaks in that voice.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Voice name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-sky-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-400">Upload WAV/MP3 (most reliable)</span>
          <input
            type="file"
            accept="audio/wav,audio/mpeg,audio/mp3,.wav,.mp3"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-neutral-200"
          />
        </label>

        <Button variant="ghost" onClick={record} disabled={recording}>
          {recording ? "Recording 6s…" : "Record mic (6s)"}
        </Button>
        <Button onClick={doClone} disabled={busy || !file}>
          {busy ? "Cloning…" : "Clone & speak"}
        </Button>
      </div>

      {file && (
        <div className="text-xs text-neutral-500">
          selected: <span className="text-neutral-300">{file.name}</span> (
          {(file.size / 1024).toFixed(0)} KB)
        </div>
      )}

      {err && <ErrorNote>{err}</ErrorNote>}

      {clonedId && (
        <div className="flex flex-col gap-2">
          <Metric label="cloned voice id" value={clonedId} hint="saved to tts-server/voices/" />
          {testUrl && <audio key={testUrl} controls autoPlay src={testUrl} className="w-full" />}
          <p className="text-xs text-neutral-500">
            It now appears in the Synthesize tab’s voice list.
          </p>
        </div>
      )}
    </div>
  );
}
