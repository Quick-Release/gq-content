import { enhanceDesignCoverVideosHtml } from "./cover-video-html";
import { parseFragment } from "parse5";
import {
  type PresentationModel,
  presentationModel,
  presentationVariables,
} from "@quick-release/design-renderer";
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

import { rootAttributesHtml } from "./html";

/** Apply the canonical presentation to a saved block's root shell, preserving
 * its content and attributes. Install presentationStyleSheet once for the Site.
 * Unsupported settings fail through the shared renderer. No shell is invented.
 */
export function presentationHtml(
  name: string,
  html: string,
  presentation?: unknown,
  options: { model?: PresentationModel; attributes?: Record<string, unknown> } = {},
): string {
  if (name === "core/cover") html = enhanceDesignCoverVideosHtml(html);
  const model = options.model ?? presentationModel;
  if (!Object.hasOwn(model.capabilities, name) && presentation === undefined) return html;
  const variables = presentationVariables(name, presentation, options);
  const root = parseFragment(html, { sourceCodeLocationInfo: true }).childNodes.find(
    (node) => "tagName" in node,
  );
  if (!root || !("attrs" in root) || !root.sourceCodeLocation?.startTag) return html;
  const classes = new Set(
    (root.attrs.find((attr) => attr.name === "class")?.value ?? "").split(/\s+/).filter(Boolean),
  );
  const selector = model.targets?.[name]?.selector ?? model.selectors?.[name];
  if (selector?.startsWith(".") && /^\.[a-zA-Z_][a-zA-Z0-9_-]*$/.test(selector))
    classes.add(selector.slice(1));
  else if (!selector) classes.add(`wp-block-${name.replace("/", "-")}`);
  classes.add("gqd-presentation");
  const oldStyle = root.attrs.find((attr) => attr.name === "style")?.value ?? "";
  let retainedStyle =
    presentation === undefined
      ? oldStyle
      : oldStyle
          .replace(/(?:^|;)\s*--gqd-(?:base|sm|md|lg|xl|2xl)-[\w-]+\s*:[^;]*/g, "")
          .replace(/^;+|;+$/g, "");
  for (const key of Object.keys(variables))
    retainedStyle = retainedStyle.replace(new RegExp(`(?:^|;)\\s*${key}\\s*:[^;]*`, "g"), "");
  retainedStyle = retainedStyle.replace(/^;+|;+$/g, "");
  const style = [
    retainedStyle,
    ...Object.entries(variables).map(([key, value]) => `${key}:${value}`),
  ]
    .filter(Boolean)
    .join(";");
  return rootAttributesHtml(html, {
    class: [...classes].join(" "),
    style: style || undefined,
  });
}

export {
  resolveDesignTheme,
  designThemeVariables,
  designThemeStyleSheet,
  resolvePresentationToken,
} from "@quick-release/design-renderer";
export type {
  DesignTheme,
  DesignThemeOverrides,
  PresentationTargets,
} from "@quick-release/design-renderer";

export {
  videoHeroStyleSheet,
  videoHeroFrameGeometry,
  createPresentationModel,
} from "@quick-release/design-renderer";
export type { VideoHeroFit, VideoHeroPosition } from "@quick-release/design-renderer";

export { selectSiteLogo } from "@quick-release/design-renderer";
