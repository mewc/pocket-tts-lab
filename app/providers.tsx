"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

// Write-only client key — safe to ship in a public app. Env overrides if you fork.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "phc_U1UhLW83d9zSKIEdb333G40VcG43LXcFqzAiGkBKQ94";
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://t.chartcastr.com";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return;
    posthog.init(KEY, {
      api_host: HOST,
      defaults: "2026-05-30",
    });
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
