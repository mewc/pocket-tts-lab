// Thin pass-through proxy so the browser talks to one origin (Next on 4703) and the
// Python Pocket TTS sidecar (127.0.0.1:4706) — no CORS, streaming bodies untouched.
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const TTS_BASE = `http://127.0.0.1:${process.env.TTS_PORT ?? "4706"}`;

async function forward(req: NextRequest, path: string[]) {
  const url = new URL(req.url);
  const target = `${TTS_BASE}/${path.join("/")}${url.search}`;

  const init: RequestInit = {
    method: req.method,
    headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
    // @ts-expect-error - duplex is required for streaming request bodies in undici
    duplex: "half",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      { error: `TTS sidecar unreachable at ${TTS_BASE}. Is it running? (bun run tts)` },
      { status: 502 },
    );
  }

  // Stream the response straight through, preserving X-* metric headers.
  const headers = new Headers();
  upstream.headers.forEach((v, k) => {
    if (k === "content-encoding" || k === "content-length") return;
    headers.set(k, v);
  });
  return new Response(upstream.body, { status: upstream.status, headers });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
