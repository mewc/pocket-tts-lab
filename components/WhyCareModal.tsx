"use client";

import { useEffect } from "react";
import type { Health } from "@/lib/tts";
import WhyCarePanel from "@/components/WhyCarePanel";

export default function WhyCareModal({
  open,
  onClose,
  health,
}: {
  open: boolean;
  onClose: () => void;
  health: Health | null;
}) {
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
        <h2 className="mb-1 text-lg font-semibold text-neutral-100">Why care?</h2>
        <p className="mb-5 text-sm text-neutral-400">
          Cost, offline, and why a 100M-param CPU model beats big cloud TTS on latency.
        </p>
        <WhyCarePanel health={health} />
      </div>
    </div>
  );
}
