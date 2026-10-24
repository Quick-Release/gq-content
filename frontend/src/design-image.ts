import { nativeBlockHtml } from "./native-block";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { escapeAttribute, safeContentUrl } from "./html";
import { presentationHtml } from "./presentation";
import { safeDesignRichText } from "./design-text";

/** Restore an attrs-only native Image. Source intrinsics stay on img while the
 * canonical presentation targets control its wrapper and media geometry.
 * Complete saved HTML is producer-sanitized and authoritative. Source safety
 * lives here so consumers need no separate URL, srcset or caption grammar.
 * Contract validation belongs to the canonical assertDesignBlocks boundary. */
export function renderDesignImage(
  attributes: Record<string, unknown>,
  shell?: string,
  options: { name?: "core/image" | "core/post-featured-image" } = {},
): string {
  const name = options.name ?? "core/image";
  if (shell && containsImage(parseFragment(shell)))
    return presentationHtml(name, shell, attributes.presentation, { attributes });
  let image = `<img${attribute("src", imageUrl(attributes.url) || undefined)}${attribute("alt", typeof attributes.alt === "string" ? attributes.alt : "")}${attribute("title", attributes.title)}${attribute("srcset", imageSources(attributes.srcSet) || undefined)}${attribute("sizes", attributes.sizes)}${attribute("width", intrinsic(attributes.width))}${attribute("height", intrinsic(attributes.height))}>`;
  const href = safeContentUrl(attributes.href);
  if (href)
    image = `<a${attribute("href", href)}${attribute("target", attributes.linkTarget)}${attribute("rel", attributes.rel)}>${image}</a>`;
  const caption =
    typeof attributes.caption === "string" && attributes.caption
      ? `<figcaption class="wp-element-caption">${safeDesignRichText(attributes.caption)}</figcaption>`
      : "";
  return presentationHtml(
    name,
    nativeBlockHtml(
      `<figure class="${name === "core/image" ? "wp-block-image" : "wp-block-post-featured-image"}">${image}${caption}</figure>`,
      attributes,
    ),
    attributes.presentation,
    { attributes },
  );
}

function attribute(name: string, value: unknown): string {
  return typeof value === "string" ? ` ${name}="${escapeAttribute(value)}"` : "";
}

function intrinsic(value: unknown): string | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 9999999
    ? String(value)
    : undefined;
}

function imageUrl(value: unknown): string {
  const url = safeContentUrl(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

function imageSources(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .split(",")
    .flatMap((candidate) => {
      const match = candidate.trim().match(/^(\S+?)(?:\s+([1-9][0-9]*w|[0-9]+(?:\.[0-9]+)?x))?$/);
      const url = match && imageUrl(match[1]);
      return url ? [`${url}${match[2] ? ` ${match[2]}` : ""}`] : [];
    })
    .join(", ");
}

function containsImage(node: DefaultTreeAdapterMap["node"]): boolean {
  return (
    ("tagName" in node && node.tagName === "img") ||
    ("childNodes" in node && node.childNodes.some(containsImage))
  );
}
