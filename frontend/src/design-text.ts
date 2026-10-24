import { nativeBlockHtml } from "./native-block";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { escapeAttribute, safeContentUrl } from "./html";
import { presentationHtml } from "./presentation";

/** Already loaded, authorized values. No lookup, fetching or query selection.
 * Site title and description are plain text, as returned by WP settings. */
export interface DesignTextContext {
  site?: { title?: string; description?: string; url?: string };
  post?: {
    uri?: string;
    /** Caller selects/formats the requested date using the block's format,
     * date source and Site timezone; this adapter never guesses them. */
    date?: { text: string; dateTime: string };
    /** Supplied inline rich text, not a generated/truncated post body. */
    excerpt?: string;
  };
}

/** Restore source-only native text. Saved, producer-sanitized shells stay with
 * the caller; childrenHtml contains HTML already rendered by that same caller.
 * undefined means this adapter cannot supply the block, never placeholder text.
 * Presentation validation and all styling belong to the shared renderer. */
export function renderDesignText(
  name: string,
  attributes: Record<string, unknown>,
  childrenHtml = "",
  context: DesignTextContext = {},
): string | undefined {
  let html: string;
  if (name === "core/list") {
    const tag = attributes.ordered === true ? "ol" : "ul";
    const start =
      typeof attributes.start === "number" && Number.isSafeInteger(attributes.start)
        ? String(attributes.start)
        : undefined;
    html = `<${tag} class="wp-block-list"${attribute("start", start)}${attributes.reversed === true ? " reversed" : ""}>${childrenHtml}</${tag}>`;
  } else if (name === "core/buttons") {
    html = `<div class="wp-block-buttons">${childrenHtml}</div>`;
  } else if (["core/heading", "core/paragraph", "core/list-item"].includes(name)) {
    if (typeof attributes.content !== "string") return undefined;
    const tag =
      name === "core/heading"
        ? headingTag(attributes.level, 2)
        : name === "core/paragraph"
          ? "p"
          : "li";
    html = `<${tag}>${safeDesignRichText(attributes.content)}${childrenHtml}</${tag}>`;
  } else if (name === "core/button") {
    if (typeof attributes.text !== "string") return undefined;
    const tag = attributes.tagName === "button" ? "button" : "a";
    const attrs =
      tag === "a"
        ? `${attribute("href", safeContentUrl(attributes.url) || undefined)}${attribute("target", attributes.linkTarget)}${attribute("rel", attributes.rel)}`
        : attribute(
            "type",
            ["button", "submit", "reset"].includes(String(attributes.type))
              ? String(attributes.type)
              : "button",
          );
    html = `<div class="wp-block-button"><${tag} class="wp-block-button__link wp-element-button"${attrs}${attribute("title", attributes.title)}>${safeDesignRichText(attributes.text)}</${tag}></div>`;
  } else if (name === "core/site-title") {
    if (typeof context.site?.title !== "string") return undefined;
    const tag = attributes.level === 0 ? "p" : headingTag(attributes.level, 1);
    let title = escapeAttribute(context.site.title);
    if (attributes.isLink !== false) {
      const url = safeContentUrl(context.site.url);
      if (!url) return undefined;
      title = `<a${attribute("href", url)} target="_self" rel="home">${title}</a>`;
    }
    html = `<${tag} class="wp-block-site-title">${title}</${tag}>`;
  } else if (name === "core/site-tagline") {
    if (typeof context.site?.description !== "string") return undefined;
    html = `<p class="wp-block-site-tagline">${escapeAttribute(context.site.description)}</p>`;
  } else if (name === "core/post-date") {
    const date = context.post?.date;
    if (typeof date?.text !== "string" || typeof date.dateTime !== "string") return undefined;
    let time = `<time${attribute("datetime", date.dateTime)}>${escapeAttribute(date.text)}</time>`;
    if (attributes.isLink === true) {
      const url = safeContentUrl(context.post?.uri);
      if (!url) return undefined;
      time = `<a${attribute("href", url)}>${time}</a>`;
    }
    html = `<div class="wp-block-post-date">${time}</div>`;
  } else if (name === "core/post-excerpt") {
    if (typeof context.post?.excerpt !== "string") return undefined;
    html = `<div class="wp-block-post-excerpt"><p class="wp-block-post-excerpt__excerpt">${safeDesignRichText(context.post.excerpt)}</p></div>`;
  } else return undefined;
  return presentationHtml(name, nativeBlockHtml(html, attributes), attributes.presentation, {
    attributes,
  });
}

function headingTag(level: unknown, fallback: number): string {
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6
    ? `h${level}`
    : `h${fallback}`;
}

function attribute(name: string, value: unknown): string {
  return typeof value === "string" ? ` ${name}="${escapeAttribute(value)}"` : "";
}

const INLINE = new Set(
  "a abbr b br cite code del em i ins kbd mark q s samp small span strong sub sup time u var".split(
    " ",
  ),
);
const DROP = new Set(
  "script style iframe object embed template noscript textarea xmp plaintext".split(" "),
);

/** Small shared source-rich-text boundary; also suitable for Image captions.
 * Rebuild parsed HTML, preserving safe inline formatting without executable
 * attributes, embedded documents, foreign namespaces or source CSS. */
export function safeDesignRichText(value: string): string {
  function render(node: DefaultTreeAdapterMap["node"]): string {
    if ("value" in node && node.nodeName === "#text") return escapeAttribute(node.value);
    if (
      !("tagName" in node) ||
      node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      DROP.has(node.tagName)
    )
      return "";
    const children = node.childNodes.map(render).join("");
    if (!INLINE.has(node.tagName)) return children;
    const attrs = node.attrs
      .map(({ name, value }) => {
        if (["title", "lang", "dir", "class"].includes(name)) return attribute(name, value);
        if (node.tagName === "a" && ["target", "rel"].includes(name)) return attribute(name, value);
        if (node.tagName === "a" && name === "href")
          return attribute(name, safeContentUrl(value) || undefined);
        return "";
      })
      .join("");
    return `<${node.tagName}${attrs}>${node.tagName === "br" ? "" : `${children}</${node.tagName}>`}`;
  }
  return parseFragment(value).childNodes.map(render).join("");
}
