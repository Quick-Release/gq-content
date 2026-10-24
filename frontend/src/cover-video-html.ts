import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { rootAttributesHtml } from "./html";

type Node = DefaultTreeAdapterMap["node"];
const hasClass = (node: Node, name: string): boolean =>
  "attrs" in node &&
  (node.attrs
    .find((attr) => attr.name === "class")
    ?.value.split(/\s+/)
    .includes(name) ??
    false);

/** Native decorative Cover video must not start before motion preferences are
 * known. Retain every source, poster, child and independent video attribute. */
export function enhanceDesignCoverVideosHtml(html: string): string {
  if (!html.includes("wp-block-cover__video-background")) return html;
  const edits: { start: number; end: number; html: string }[] = [];
  const visit = (node: Node) => {
    if (
      "tagName" in node &&
      node.tagName === "video" &&
      hasClass(node, "wp-block-cover__video-background") &&
      node.parentNode &&
      hasClass(node.parentNode, "wp-block-cover") &&
      node.attrs.some((attr) => attr.name === "autoplay")
    ) {
      const tag = node.sourceCodeLocation?.startTag;
      if (tag)
        edits.push({
          start: tag.startOffset,
          end: tag.endOffset,
          html: rootAttributesHtml(html.slice(tag.startOffset, tag.endOffset), {
            autoplay: undefined,
          }),
        });
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parseFragment(html, { sourceCodeLocationInfo: true }));
  for (const edit of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, edit.start) + edit.html + html.slice(edit.end);
  return html;
}
