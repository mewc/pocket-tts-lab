import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone island: pin the Turbopack dev root to this app so the file-watcher
  // doesn't walk up to the monorepo's topmost lockfile and pin the CPU.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
