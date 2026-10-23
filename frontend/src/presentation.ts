import { parseFragment } from "parse5";
import { presentationModel, presentationVariables } from "@quick-release/design-renderer";
export {
  presentationModel,
  presentationVariables,
  presentationStyleSheet,
} from "@quick-release/design-renderer";
export type {
  Presentation,
  PresentationTheme,
  PresentationModel,
  PresentationBreakpoint,
  Property as PresentationProperty,
} from "@quick-release/design-renderer";

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Apply the canonical presentation to a saved block's root shell, preserving
 * its content and attributes. Install presentationStyleSheet once for the Site.
 * Unsupported settings fail through the shared renderer. No shell is invented.
 */
export function presentationHtml(name: string, html: string, presentation?: unknown): string {
  if (!Object.hasOwn(presentationModel.capabilities, name) && presentation === undefined)
    return html;
  const variables = presentationVariables(name, presentation);
  const root = parseFragment(html, { sourceCodeLocationInfo: true }).childNodes.find(
    (node) => "tagName" in node,
  );
  if (!root || !("attrs" in root) || !root.sourceCodeLocation?.startTag) return html;
  const location = root.sourceCodeLocation.startTag;
  const classes = new Set(
    (root.attrs.find((attr) => attr.name === "class")?.value ?? "").split(/\s+/).filter(Boolean),
  );
  classes.add(`wp-block-${name.replace("/", "-")}`);
  classes.add("gqd-presentation");
  const oldStyle = root.attrs.find((attr) => attr.name === "style")?.value ?? "";
  const retainedStyle =
    presentation === undefined
      ? oldStyle
      : oldStyle
          .replace(/(?:^|;)\s*--gqd-(?:base|sm|md|lg|xl|2xl)-[\w-]+\s*:[^;]*/g, "")
          .replace(/^;+|;+$/g, "");
  const style = [
    retainedStyle,
    ...Object.entries(variables).map(([key, value]) => `${key}:${value}`),
  ]
    .filter(Boolean)
    .join(";");
  let opening = html.slice(location.startOffset, location.endOffset);
  const removed = ["class", "style"]
    .map((attr) => root.sourceCodeLocation?.attrs?.[attr])
    .filter((attr) => attr !== undefined)
    .sort((a, b) => b.startOffset - a.startOffset);
  for (const attr of removed)
    opening =
      opening.slice(0, attr.startOffset - location.startOffset) +
      opening.slice(attr.endOffset - location.startOffset);
  opening = opening.replace(
    /\s*\/?>$/,
    `${` class="${escapeAttribute([...classes].join(" "))}"`}${style ? ` style="${escapeAttribute(style)}"` : ""}>`,
  );
  return html.slice(0, location.startOffset) + opening + html.slice(location.endOffset);
}
