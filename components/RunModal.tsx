"use client";

import { useEffect, useState } from "react";

const REPO = "https://github.com/mewc/pocket-tts-lab";

// A detailed, self-contained prompt — paste into any coding agent and it sets the whole
// thing up (prereqs, install, run, first-run weight download, Docker fallback, keys).
const CLAUDE_PROMPT = `Clone and run "Pocket TTS Lab" on my machine so I can open it at http://localhost:4703.

Repo: ${REPO} (public, MIT). It's a Next.js UI plus a small Python sidecar that runs Kyutai pocket-tts — a 100M-parameter, CPU-only text-to-speech model. No GPU, no API keys, $0.

Prereqs (install if missing): Bun (https://bun.sh) and uv (https://docs.astral.sh/uv/).

Steps:
1. git clone ${REPO}.git && cd pocket-tts-lab
2. bun install            # JS deps
3. bun run tts:sync       # Python sidecar deps (CPU torch + pocket-tts) via uv
4. bun run dev            # boots the Next UI on :4703 and the TTS sidecar on :4706

Notes:
- The first synthesis downloads the model weights from HuggingFace (~hundreds of MB) into ~/.cache — slow once, instant after. Then open http://localhost:4703.
- Prefer Docker? A single image runs both halves: \`docker build -t pocket-tts-lab . && docker run -p 4703:4703 pocket-tts-lab\`.
- Everything is keyless. Optional: put XAI_API_KEY or OPENAI_API_KEY in .env.local for a real LLM brain in the Converse tab.

Verify it works by opening the Benchmark tab and running it — you should see ~6-9x real-time and a first audio chunk in tens of milliseconds.`;

const CLONE_STEPS = `git clone ${REPO}.git
cd pocket-tts-lab
bun install          # JS deps
bun run tts:sync     # Python sidecar (needs uv)
bun run dev          # UI :4703 + sidecar :4706
# → open http://localhost:4703`;

const DOCKER_STEPS = `git clone ${REPO}.git
cd pocket-tts-lab
docker build -t pocket-tts-lab .
docker run -p 4703:4703 -v pkttts:/data pocket-tts-lab
# single image runs the UI + Python sidecar
# → open http://localhost:4703`;

export default function RunModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          ✕
        </button>

        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-neutral-100">Run it yourself</h2>
          <span className="rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-300">
            free · open source · MIT
          </span>
        </div>
        <p className="mb-5 text-sm text-neutral-400">
          The live demo runs on a shared server CPU. Clone it and it runs entirely on{" "}
          <em>your</em> machine — no GPU, no API keys, $0. Pick whichever path fits you:
        </p>

        <div className="flex flex-col gap-4">
          <CopyCard
            title="① One prompt for a coding agent"
            hint="Paste into Claude Code (or any agent) — it installs prereqs, clones, and runs it."
            value={CLAUDE_PROMPT}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <CopyCard
              title="② Clone & run (Bun + uv)"
              hint="Needs Bun and uv. Two commands to install, one to run."
              value={CLONE_STEPS}
            />
            <CopyCard
              title="③ Docker (single image)"
              hint="No Bun/uv needed — one image runs the UI + Python sidecar."
              value={DOCKER_STEPS}
            />
          </div>
        </div>

        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm text-sky-400 hover:underline"
        >
          View on GitHub → {REPO.replace("https://", "")}
        </a>
      </div>
    </div>
  );
}

function CopyCard({ title, hint, value }: { title: string; hint: string; value: string }) {
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
      <div className="relative mt-auto">
        {/* capped to ~3 lines; scroll to read the rest */}
        <pre className="max-h-[4.75rem] overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950 p-3 pr-14 font-mono text-[11px] leading-[1.35rem] text-neutral-300">
          {value}
        </pre>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 rounded-b-lg bg-gradient-to-t from-neutral-950 to-transparent" />
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
