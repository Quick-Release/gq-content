// Guards shared by the Site's own endpoints (consent records, form posts):
// same-origin only, and a body read that stops at a bound. No content runtime.

/**
 * Whether a browser posted from the Site itself. A cross-site post carries
 * its Origin (and Sec-Fetch-Site); `origins` are the Site's public origins
 * when the Worker sees another (a proxy). The request's own origin is always
 * accepted.
 */
export function isSameOrigin(request: Request, origins: ReadonlySet<string>): boolean {
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return false;
  if (!origin) return false;
  if (origin === new URL(request.url).origin || origins.has(origin)) return true;
  // Behind an adapter or proxy the request URL may name another host
  // (Astro's Node adapter uses localhost): the browser's Host header is the
  // origin it posted to.
  try {
    return new URL(origin).host === request.headers.get("Host");
  } catch {
    return false;
  }
}

/** The body as text, or null once it exceeds `limit` bytes (declared or read). */
export async function readBoundedBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
