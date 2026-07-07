/**
 * Dev runner: boot the Python Pocket TTS sidecar (uv/uvicorn) and Next together,
 * prefix their logs, and tear both down on exit. Run via `bun run dev`.
 */
const TTS_PORT = process.env.TTS_PORT ?? "4706";
const WEB_PORT = "4703";

type Proc = { name: string; color: string; child: ReturnType<typeof Bun.spawn> };

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
      for (const line of text.split("\n")) {
        if (line.length) console.log(`${prefix} ${line}`);
      }
    }
  };
  void pipe(child.stdout as ReadableStream<Uint8Array>);
  void pipe(child.stderr as ReadableStream<Uint8Array>);
  return { name, color, child };
}

console.log(`\x1b[36m→ pocket-tts-lab: sidecar :${TTS_PORT}  ·  web :${WEB_PORT}\x1b[0m`);
console.log(`\x1b[36m→ first model use downloads weights from HuggingFace (slow, once)\x1b[0m`);

const procs: Proc[] = [
  launch(
    "tts",
    "35",
    ["uv", "run", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", TTS_PORT],
    new URL("../tts-server", import.meta.url).pathname,
  ),
  launch("web", "32", ["bun", "run", "next", "dev", "--port", WEB_PORT], undefined, {
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

// If either process dies, bring the whole thing down.
await Promise.race(procs.map((p) => p.child.exited));
shutdown();
