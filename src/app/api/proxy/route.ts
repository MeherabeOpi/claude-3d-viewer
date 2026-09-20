import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hosts that resolve to private network space are never fetched. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
]);

const PRIVATE_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

const MAX_BYTES = 200 * 1024 * 1024;

function rejectedReason(raw: string): string | null {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return "Not a valid absolute URL.";
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return "Only http and https URLs can be fetched.";
  }
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(host)) return "That host is not allowed.";
  if (PRIVATE_RANGES.some((range) => range.test(host))) {
    return "That host is not allowed.";
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return "That host is not allowed.";
  }
  return null;
}

async function handle(request: NextRequest, method: "GET" | "HEAD") {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return new Response("Missing url parameter.", { status: 400 });
  }

  const reason = rejectedReason(raw);
  if (reason) {
    return new Response(reason, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(raw, {
      method,
      redirect: "follow",
      headers: {
        // Pass range through so large models can stream.
        ...(request.headers.get("range")
          ? { range: request.headers.get("range") as string }
          : {}),
        accept: "*/*",
      },
    });
  } catch {
    return new Response("Could not reach that URL.", { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    return new Response(
      `Upstream responded ${upstream.status} ${upstream.statusText}`.trim(),
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return new Response("That file is larger than the 200 MB limit.", {
      status: 413,
    });
  }

  const headers = new Headers();
  const passThrough = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "etag",
  ];
  for (const name of passThrough) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", "public, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  // The proxy only ever serves asset bytes, never markup to be interpreted.
  headers.set("content-security-policy", "default-src 'none'; sandbox");

  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function GET(request: NextRequest) {
  return handle(request, "GET");
}

export async function HEAD(request: NextRequest) {
  return handle(request, "HEAD");
}
