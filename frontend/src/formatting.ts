import type { Delivery } from "./content-types";
export function responseStatus(delivery: { kind: Delivery<unknown>["kind"] }) {
  if (delivery.kind === "found") return 200;
  return delivery.kind === "missing" ? 404 : 503;
}

/**
 * WPGraphQL's GMT time ("2026-10-02T09:00:00", without a zone) in ms, or null
 * when it is absent or not a time.
 */
export function cmsTime(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(time) ? null : time;
}
/**
 * An entry's URI as a path. A CMS whose permalinks point at the Frontend gives
 * absolute URIs (`https://acme.example/team/`); only the path is the route.
 * Percent-encoding and the trailing slash are kept as WordPress gives them.
 */
export function uriPath(uri: string) {
  try {
    return new URL(uri, "https://frontend.invalid").pathname;
  } catch {
    return uri;
  }
}
export function menuItemHref(url: string, internalOrigins: string[]) {
  try {
    const parsed = new URL(url, internalOrigins[0]);
    if (!internalOrigins.includes(parsed.origin)) return url;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
export function stripHtml(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function formatDate(value: string, lang = "en") {
  return new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}
export function routeOf(path: string) {
  let route = path;
  try {
    route = decodeURI(path);
  } catch {
    // Not percent-encoded validly; WordPress has no such URI, so keep it as is.
  }
  if (!route.startsWith("/")) route = `/${route}`;
  return route.endsWith("/") ? route : `${route}/`;
}
