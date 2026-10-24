import { parseFragment } from "parse5";
/** Escape a value for a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Browser-safe HTTP(S), relative path, or fragment; media also uses this boundary. */
export function safeContentUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url || url.startsWith("//") || url.includes("\\")) return "";
  for (const char of url) {
    if (char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) return "";
  }
  if (url.startsWith("/") || url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? url
      : "";
  } catch {
    return "";
  }
}

/** Change only named root attributes, preserving the saved subtree and source. */
export function rootAttributesHtml(
  html: string,
  values: Record<string, string | undefined>,
  defaults: Record<string, string | undefined> = {},
): string {
  const root = parseFragment(html, { sourceCodeLocationInfo: true }).childNodes.find(
    (node) => "tagName" in node,
  );
  if (!root || !("attrs" in root) || !root.sourceCodeLocation?.startTag) return html;
  const location = root.sourceCodeLocation.startTag;
  const attrs = {
    ...Object.fromEntries(
      Object.entries(defaults).filter(
        ([name, value]) => value !== undefined && !root.attrs.some((attr) => attr.name === name),
      ),
    ),
    ...values,
  };
  let opening = html.slice(location.startOffset, location.endOffset);
  const removed = Object.keys(attrs)
    .map((name) => root.sourceCodeLocation?.attrs?.[name])
    .filter((attr) => attr !== undefined)
    .sort((a, b) => b.startOffset - a.startOffset);
  for (const attr of removed)
    opening =
      opening.slice(0, attr.startOffset - location.startOffset) +
      opening.slice(attr.endOffset - location.startOffset);
  opening = opening.replace(
    /\s*\/?>$/,
    Object.entries(attrs)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join("") + ">",
  );
  return html.slice(0, location.startOffset) + opening + html.slice(location.endOffset);
}
