import { parseFragment } from "parse5";
import { resolvePresentationToken } from "@quick-release/design-renderer";
import { rootAttributesHtml } from "./html";

/** Native block-support attributes on a reconstructed shell. Complete saved
 * shells and Site renderer output remain authoritative. This is independent of
 * presentation: native colors use the owning safe color grammar, while authored
 * neutral controls still win through canonical CSS. */
export function nativeBlockHtml(html: string, attributes: Record<string, unknown>): string {
  const root = parseFragment(html).childNodes.find((node) => "tagName" in node);
  if (!root || !("attrs" in root)) return html;
  const classes = new Set(
    (root.attrs.find((entry) => entry.name === "class")?.value ?? "").split(/\s+/).filter(Boolean),
  );
  if (typeof attributes.className === "string")
    for (const name of attributes.className.split(/\s+/).filter(Boolean)) classes.add(name);
  if (typeof attributes.align === "string" && /^[a-z0-9-]+$/.test(attributes.align))
    classes.add(`align${attributes.align}`);
  for (const [key, suffix, marker] of [
    ["textColor", "color", "has-text-color"],
    ["backgroundColor", "background-color", "has-background"],
  ]) {
    const value = attributes[key];
    if (typeof value === "string" && /^[a-z0-9-]+$/.test(value)) {
      classes.add(`has-${value}-${suffix}`);
      classes.add(marker);
    }
  }
  const originalStyle = root.attrs.find((entry) => entry.name === "style")?.value ?? "";
  const styles = [originalStyle];
  const nativeStyle = attributes.style;
  const color =
    nativeStyle && typeof nativeStyle === "object" && "color" in nativeStyle
      ? nativeStyle.color
      : undefined;
  if (color && typeof color === "object") {
    for (const [property, key, marker] of [
      ["color", "text", "has-text-color"],
      ["background-color", "background", "has-background"],
    ]) {
      const value = (color as Record<string, unknown>)[key];
      const css =
        typeof value === "string"
          ? resolvePresentationToken("color", { literal: value })
          : undefined;
      if (css && !new RegExp(`(?:^|;)\\s*${property}\\s*:`, "i").test(originalStyle)) {
        styles.push(`${property}:${css}`);
        classes.add(marker);
      }
    }
  }
  const style = styles.filter(Boolean).join(";");
  return rootAttributesHtml(
    html,
    { class: [...classes].join(" "), style: style || undefined },
    {
      id:
        typeof attributes.anchor === "string" && attributes.anchor ? attributes.anchor : undefined,
    },
  );
}
