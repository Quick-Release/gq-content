// The visitor's address for the Site's own endpoints (form posts, consent
// records): what keys their rate limits and what Turnstile is told. No
// content runtime, nothing stored.
//
// Cloudflare sets CF-Connecting-IP to whoever connected to it. When that is a
// reverse proxy the Site runs (a Site's `trustedProxies`), the visitor's
// address is the one that proxy forwarded; a forwarding header from anyone
// else is never believed.

type Address = { version: 4 | 6; bytes: Uint8Array };
type Range = { version: 4 | 6; bytes: Uint8Array; prefix: number };

function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (const [index, part] of parts.entries()) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null;
    bytes[index] = Number(part);
  }
  return bytes;
}

function parseIpv6(text: string): Uint8Array | null {
  let head = text;
  let tail: number[] = [];
  // An embedded IPv4 (::ffff:192.0.2.1) is its last two groups.
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".", lastColon)) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (!v4) return null;
    head = text.slice(0, lastColon + 1);
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const left = groups(halves[0]!);
  const right = halves.length === 2 ? groups(halves[1]!) : [];
  const words: number[] = [];
  for (const group of [...left, ...right]) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    words.push(parseInt(group, 16));
  }
  const given = words.length + tail.length;
  if (halves.length === 2 ? given > 7 : given !== 8) return null;
  const all = [
    ...words.slice(0, left.length),
    ...Array<number>(8 - given).fill(0),
    ...words.slice(left.length),
    ...tail,
  ];
  const bytes = new Uint8Array(16);
  all.forEach((word, index) => {
    bytes[index * 2] = word >> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

/** An IPv4 or IPv6 address; an IPv4-mapped IPv6 address reads as its IPv4. */
function parseAddress(value: string): Address | null {
  const text = value.trim();
  if (!text || text.length > 64) return null;
  if (!text.includes(":")) {
    const bytes = parseIpv4(text);
    return bytes ? { version: 4, bytes } : null;
  }
  const bytes = parseIpv6(text.replace(/%[0-9a-z._~-]+$/i, ""));
  if (!bytes) return null;
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return mapped ? { version: 4, bytes: bytes.slice(12) } : { version: 6, bytes };
}

/** An X-Forwarded-For entry: an address, optionally `[v6]:port` or `v4:port`. */
function parseForwarded(value: string): Address | null {
  const text = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(text);
  if (bracketed) return parseAddress(bracketed[1]!);
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(text);
  return parseAddress(withPort ? withPort[1]! : text);
}

function format(address: Address): string {
  if (address.version === 4) return address.bytes.join(".");
  const words = Array.from({ length: 8 }, (_, index) =>
    ((address.bytes[index * 2]! << 8) | address.bytes[index * 2 + 1]!).toString(16),
  );
  // RFC 5952: the longest run of two or more zero groups (the first) is "::".
  let start = -1;
  let length = 0;
  for (let index = 0; index < 8;) {
    if (words[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < 8 && words[end] === "0") end += 1;
    if (end - index > length && end - index > 1) [start, length] = [index, end - index];
    index = end;
  }
  if (start < 0) return words.join(":");
  return `${words.slice(0, start).join(":")}::${words.slice(start + length).join(":")}`;
}

function parseRange(value: string): Range {
  const [text, prefixText, extra] = value.trim().split("/");
  const address = extra === undefined ? parseAddress(text ?? "") : null;
  if (!address) throw new Error(`trustedProxies: "${value}" isn't an IP address or CIDR`);
  const bits = address.bytes.length * 8;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if ((prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) || prefix > bits)
    throw new Error(`trustedProxies: "${value}" has an invalid prefix length`);
  // A /0 would believe anyone's forwarding headers.
  if (prefix === 0) throw new Error(`trustedProxies: "${value}" would trust every address`);
  return { ...address, prefix };
}

function contains(range: Range, address: Address): boolean {
  if (range.version !== address.version) return false;
  const whole = range.prefix >> 3;
  for (let index = 0; index < whole; index += 1)
    if (range.bytes[index] !== address.bytes[index]) return false;
  const rest = range.prefix & 7;
  if (!rest) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (range.bytes[whole]! & mask) === (address.bytes[whole]! & mask);
}

/**
 * The client address of a request, from `CF-Connecting-IP` and, only when
 * that is one of `trustedProxies` (addresses or CIDRs, IPv4 or IPv6), the
 * proxy's forwarding headers: the right-most `X-Forwarded-For` entry that
 * isn't itself a trusted proxy, else `X-Real-IP`. Null when there is no
 * usable `CF-Connecting-IP`. Throws on an invalid `trustedProxies` entry.
 */
export function clientAddressResolver(
  trustedProxies: readonly string[] = [],
): (request: Request) => string | null {
  const ranges = trustedProxies.map(parseRange);
  const trusted = (address: Address) => ranges.some((range) => contains(range, address));
  return (request) => {
    const peer = parseAddress(request.headers.get("CF-Connecting-IP") ?? "");
    if (!peer) return null;
    if (!trusted(peer)) return format(peer);
    const forwarded = (request.headers.get("X-Forwarded-For") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
      const address = parseForwarded(forwarded[index]!);
      // An entry the proxy can't vouch for ends the walk: the proxy itself is the client.
      if (!address) return format(peer);
      if (!trusted(address)) return format(address);
    }
    const real = parseAddress(request.headers.get("X-Real-IP") ?? "");
    return real && !trusted(real) ? format(real) : format(peer);
  };
}

/**
 * A rate-limit key for a client address: an IPv4 address as itself, an IPv6
 * address as its /64 (`2001:db8:1:2::/64`), since one subscriber holds a
 * whole /64. `unknown` without an address.
 */
export function rateLimitKey(address: string | null): string {
  const parsed = address === null ? null : parseAddress(address);
  if (!parsed) return "unknown";
  if (parsed.version === 4) return format(parsed);
  const network = new Uint8Array(16);
  network.set(parsed.bytes.slice(0, 8));
  return `${format({ version: 6, bytes: network })}/64`;
}
