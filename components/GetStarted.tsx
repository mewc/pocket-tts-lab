"use client";

import { useState } from "react";

const REPO = "https://github.com/mewc/pocket-tts-lab";
const CLONE = "git clone https://github.com/mewc/pocket-tts-lab.git";
const CLAUDE_PROMPT =
  "Clone and run the Pocket TTS Lab locally so I can open it at http://localhost:4703. " +
  "Repo: https://github.com/mewc/pocket-tts-lab — a Next.js UI plus a Python pocket-tts " +
  "sidecar (CPU-only, MIT). Install the JS deps with `bun install`, sync the Python sidecar " +
  "with `bun run tts:sync` (needs uv), then start both with `bun run dev`.";

export default function GetStarted() {
  return (
    <section className="mt-12 border-t border-neutral-800 pt-8">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-neutral-100">Run it yourself</h2>
        <span className="rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-300">
          free · open source · MIT
        </span>
      </div>
      <p className="mb-5 text-sm text-neutral-400">
        The demo above runs on a server CPU. Clone it and it runs entirely on{" "}
        <em>your</em> machine — no GPU, no API keys, $0. Two ways to get going:
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <CopyCard
          title="① One prompt for Claude Code"
          hint="Paste into Claude Code (or any coding agent) — it clones, installs, and runs it."
          value={CLAUDE_PROMPT}
          preview={CLAUDE_PROMPT}
          multiline
        />
        <CopyCard
          title="② Clone the repo"
          hint="Then follow the README (needs Bun + uv), and `bun run dev`."
          value={CLONE}
          preview={CLONE}
        />
      </div>

      <a
        href={REPO}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-2 text-sm text-sky-400 hover:underline"
      >
        View on GitHub → {REPO.replace("https://", "")}
      </a>
    </section>
  );
}

function CopyCard({
  title,
  hint,
  value,
  preview,
  multiline,
}: {
  title: string;
  hint: string;
  value: string;
  preview: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-1 text-sm font-medium text-neutral-200">{title}</div>
      <p className="mb-3 text-xs text-neutral-500">{hint}</p>
      <div className="relative flex-1">
        <pre
          className={`overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 pr-12 font-mono text-xs text-neutral-300 ${
            multiline ? "whitespace-pre-wrap" : "whitespace-nowrap"
          }`}
        >
          {preview}
        </pre>
        <button
          onClick={copy}
          className={`absolute right-2 top-2 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
            copied
              ? "border-emerald-700 bg-emerald-950/60 text-emerald-300"
              : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
