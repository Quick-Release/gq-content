import {
  SERVICE_CATALOG,
  copyLanguage,
  embedService,
  hostMatches,
  hostService,
  type ConsentService,
  type ServiceId,
} from "./catalog";
import type { ConsentConfiguration } from "./configuration";
import { CONSENT_COPY } from "./copy";

/** Where rewriting runs: the Site's consent configuration and the page's language. */
export interface EmbedContext {
  configuration: ConsentConfiguration;
  /** The page's `lang` (BCP 47); placeholders follow it (CN-C3). */
  language: string;
  /**
   * Hosts that are the Site itself (its Frontend and its own CMS/media origin).
   * Relative URLs are always first party.
   */
  firstPartyHosts?: readonly string[];
}

/** An embed rewriting withheld for good: from an unknown host, an inactive service, or a script. */
export interface BlockedEmbed {
  tag: "iframe" | "script" | "embed" | "object";
  /** The host it would have contacted; `inline` for an inline script. */
  host: string;
  service: ServiceId | null;
  reason: "unknown-host" | "inactive-service" | "script";
}

export interface RewrittenHtml {
  html: string;
  /** Embeds turned into service placeholders, loadable after consent. */
  placeholders: Array<{ service: ServiceId; host: string }>;
  /** Embeds blocked for good (CN-R3), for diagnostics and readiness. */
  blocked: BlockedEmbed[];
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ELEMENT =
  /<(iframe|object)\b([^>]*)>[\s\S]*?<\/\1\s*>|<(script)\b([^>]*)>([\s\S]*?)<\/script\s*>|<(iframe|embed)\b([^>]*?)\/?>/gi;
const NON_EXECUTABLE =
  /^(?:application\/(?:ld\+)?json|text\/template|text\/x-template|importmap)$/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Text safe inside an attribute value or element content. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    if (Object.hasOwn(attributes, name)) continue;
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** The third-party URL a reference contacts, or null when it is the Site's own. */
function thirdParty(reference: string, firstPartyHosts: readonly string[]): URL | null {
  const value = reference.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value, "https://first-party.invalid/");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname === "first-party.invalid") return null;
  if (firstPartyHosts.some((host) => hostMatches(url.hostname, host.toLowerCase()))) return null;
  return url;
}

export interface PlaceholderInput {
  service: ServiceId;
  /** The embed's URL; it is only an attribute value until consent. */
  src: string;
  /** The page's `lang`. */
  language: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  /** Further iframe attributes (allow, allowfullscreen, class…), applied when it loads. */
  attributes?: Record<string, string>;
  /** A decorative embed (a background video): no notice or buttons; loads only on a grant. */
  decorative?: boolean;
}

/**
 * A placeholder for a third-party embed (CN-R13): no live `src`, naming the
 * provider and purpose and offering "Load once" and "Always allow external
 * media". The client runtime replaces it with the iframe after consent.
 * Without JavaScript it never loads. Site components use it for their own
 * embeds (a contact map); rewriteEmbeds uses it for WordPress HTML.
 */
export function embedPlaceholder(input: PlaceholderInput): string {
  const service: ConsentService = SERVICE_CATALOG[input.service];
  const copy = CONSENT_COPY[copyLanguage(input.language)];
  const attrs: Record<string, string> = { ...input.attributes, src: input.src };
  if (input.title !== undefined) attrs.title = input.title;
  if (input.width !== undefined) attrs.width = String(input.width);
  if (input.height !== undefined) attrs.height = String(input.height);
  const embed = escapeHtml(JSON.stringify({ tag: "iframe", attrs }));
  const ratio =
    Number(attrs.width) > 0 && Number(attrs.height) > 0
      ? ` style="aspect-ratio: ${Number(attrs.width)} / ${Number(attrs.height)}"`
      : "";
  const data = `data-gq-consent-embed="${input.service}" data-gq-category="${service.category}" data-gq-embed="${embed}"`;
  if (input.decorative) {
    return `<div class="gq-consent-embed gq-consent-embed--decorative" ${data} data-gq-decorative aria-hidden="true"${ratio}></div>`;
  }
  const label = escapeHtml(attrs.title ? `${service.name}: ${attrs.title}` : service.name);
  return (
    `<div class="gq-consent-embed" ${data} role="group" aria-label="${label}"${ratio}>` +
    `<div class="gq-consent-embed__notice">` +
    `<p class="gq-consent-embed__text">${escapeHtml(copy.placeholderText(service.name, service.provider))}</p>` +
    `<p class="gq-consent-embed__purpose">${escapeHtml(service.purpose[copyLanguage(input.language)])}</p>` +
    `<div class="gq-consent-embed__actions">` +
    `<button type="button" class="gq-consent-button" data-gq-consent-load-once>${escapeHtml(copy.loadOnce)}</button>` +
    `<button type="button" class="gq-consent-button" data-gq-consent-allow="${service.category}">${escapeHtml(copy.alwaysAllow)}</button>` +
    `</div></div></div>`
  );
}

/** The generic placeholder for an embed that may never load (CN-R3). */
export function blockedPlaceholder(host: string, tag: BlockedEmbed["tag"], language: string) {
  const copy = CONSENT_COPY[copyLanguage(language)];
  if (tag === "script")
    return `<span hidden data-gq-consent-blocked="${escapeHtml(host)}" data-gq-tag="script"></span>`;
  return `<div class="gq-consent-blocked" data-gq-consent-blocked="${escapeHtml(host)}" data-gq-tag="${tag}" role="note"><p>${escapeHtml(copy.blockedText(host))}</p></div>`;
}

/**
 * Rewrites published HTML so its initial form contacts no third party
 * (CN-R1, CN-R3, CN-R13): iframes of active catalog services become
 * placeholders; other third-party iframes, embeds and objects, and every
 * third-party or inline executable script, are blocked and reported.
 * First-party and non-executable content is left byte for byte.
 */
export function rewriteEmbeds(html: string, context: EmbedContext): RewrittenHtml {
  const firstParty = context.firstPartyHosts ?? [];
  const placeholders: RewrittenHtml["placeholders"] = [];
  const blocked: BlockedEmbed[] = [];
  const block = (
    tag: BlockedEmbed["tag"],
    host: string,
    service: ServiceId | null,
    reason: BlockedEmbed["reason"],
  ) => {
    blocked.push({ tag, host, service, reason });
    return blockedPlaceholder(host, tag, context.language);
  };
  const rewritten = html.replace(
    ELEMENT,
    (
      whole,
      pairedTag?: string,
      pairedAttrs?: string,
      scriptTag?: string,
      scriptAttrs?: string,
      scriptBody?: string,
      voidTag?: string,
      voidAttrs?: string,
    ) => {
      if (scriptTag) {
        const attrs = attributesOf(scriptAttrs ?? "");
        if (attrs.type && NON_EXECUTABLE.test(attrs.type.trim())) return whole;
        if (attrs.src !== undefined) {
          const url = thirdParty(attrs.src, firstParty);
          return url ? block("script", url.hostname, hostService(url.hostname), "script") : whole;
        }
        return scriptBody?.trim() ? block("script", "inline", null, "script") : whole;
      }
      const tag = (pairedTag ?? voidTag)!.toLowerCase() as "iframe" | "object" | "embed";
      const attrs = attributesOf((pairedAttrs ?? voidAttrs) || "");
      const reference = tag === "object" ? attrs.data : attrs.src;
      if (reference === undefined) {
        return tag === "iframe" && attrs.srcdoc !== undefined
          ? block(tag, "inline", null, "unknown-host")
          : whole;
      }
      const url = thirdParty(reference, firstParty);
      if (!url) return whole;
      const service = tag === "iframe" ? embedService(url) : null;
      if (!service) return block(tag, url.hostname, hostService(url.hostname), "unknown-host");
      if (!context.configuration.services.includes(service))
        return block(tag, url.hostname, service, "inactive-service");
      placeholders.push({ service, host: url.hostname });
      const { src: _src, title, width, height, ...rest } = attrs;
      return embedPlaceholder({
        service,
        src: url.href,
        language: context.language,
        ...(title !== undefined ? { title } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        attributes: rest,
        decorative: /\bwp-block-getquick-design-video-hero__video\b/.test(attrs.class ?? ""),
      });
    },
  );
  return { html: rewritten, placeholders, blocked };
}
