/**
 * Production runner (used by the Docker image / Railway).
 * Boots the Python Pocket TTS sidecar (uvicorn, bound to 127.0.0.1) and the built
 * Next server (bound to 0.0.0.0:$PORT) together, prefixes logs, and tears both down
 * on exit. The browser only ever talks to Next; Next proxies to the sidecar in-process.
 */
const TTS_PORT = process.env.TTS_PORT ?? "4706";
const PORT = process.env.PORT ?? "4703";
const VENV = process.env.TTS_VENV ?? "/app/tts-server/.venv";

type Proc = { name: string; child: ReturnType<typeof Bun.spawn> };

function launch(name: string, color: string, cmd: string[], cwd?: string, env?: Record<string, string>): Proc {
  const child = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = async (stream: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    for await (const chunk of stream) {
      const text = dec.decode(chunk);
      for (const line of text.split("\n")) if (line.length) console.log(`${prefix} ${line}`);
    }
  };
  void pipe(child.stdout as ReadableStream<Uint8Array>);
  void pipe(child.stderr as ReadableStream<Uint8Array>);
  return { name, child };
}

console.log(`\x1b[36m→ pocket-tts-lab: sidecar 127.0.0.1:${TTS_PORT}  ·  web 0.0.0.0:${PORT}\x1b[0m`);

const procs: Proc[] = [
  launch(
    "tts",
    "35",
    [`${VENV}/bin/uvicorn`, "server:app", "--host", "127.0.0.1", "--port", TTS_PORT],
    `${import.meta.dir}/../tts-server`,
  ),
  launch("web", "32", ["bun", "run", "next", "start", "-p", PORT, "-H", "0.0.0.0"], `${import.meta.dir}/..`, {
    TTS_PORT,
  }),
];

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) p.child.kill();
  setTimeout(() => process.exit(0), 300);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// If either process dies, bring the whole thing down so Railway restarts us.
await Promise.race(procs.map((p) => p.child.exited));
shutdown();
