import { escapeAttribute, safeContentUrl } from "./html";
import { resolvePresentationToken } from "@quick-release/design-renderer";
import { presentationHtml } from "./presentation";

/** A public native Cover may carry no saved shell. Restore its native semantic
 * structure from producer attributes, then let the canonical targets style it. */
export function renderDesignCover(
  attributes: Record<string, unknown>,
  children: string,
  context: { featuredImage?: { sourceUrl: string; altText: string } | null } = {},
): string {
  const featured = attributes.useFeaturedImage === true ? context.featuredImage : null;
  const src = safeContentUrl(featured?.sourceUrl ?? attributes.url);
  const alt = featured?.altText ?? (typeof attributes.alt === "string" ? attributes.alt : "");
  const ratio =
    typeof attributes.dimRatio === "number" && Number.isFinite(attributes.dimRatio)
      ? Math.min(100, Math.max(0, attributes.dimRatio)) / 100
      : 0.5;
  const media = !src
    ? ""
    : attributes.backgroundType === "video"
      ? `<video class="wp-block-cover__video-background" src="${escapeAttribute(src)}" muted loop playsinline aria-hidden="true"></video>`
      : `<img class="wp-block-cover__image-background" src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}">`;
  const palette =
    typeof attributes.overlayColor === "string"
      ? resolvePresentationToken("color", { palette: attributes.overlayColor })
      : undefined;
  const literal =
    typeof attributes.customOverlayColor === "string"
      ? resolvePresentationToken("color", { literal: attributes.customOverlayColor })
      : undefined;
  const gradient =
    typeof attributes.gradient === "string" && /^[a-z0-9-]+$/.test(attributes.gradient)
      ? `var(--wp--preset--gradient--${attributes.gradient})`
      : undefined;
  const customGradient =
    typeof attributes.customGradient === "string" &&
    /^(?:repeating-)?(?:linear|radial|conic)-gradient\([a-zA-Z0-9#%,.()+ /-]+\)$/.test(
      attributes.customGradient,
    )
      ? attributes.customGradient
      : undefined;
  const overlay = `opacity:${ratio};background-color:${literal ?? palette ?? "#000"}${customGradient || gradient ? `;background-image:${customGradient ?? gradient}` : ""}`;
  const classes = [
    "wp-block-cover",
    typeof attributes.className === "string" ? attributes.className : "",
    attributes.align === "wide" || attributes.align === "full" ? `align${attributes.align}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return presentationHtml(
    "core/cover",
    `<div class="${escapeAttribute(classes)}"><span aria-hidden="true" class="wp-block-cover__background has-background-dim" style="${escapeAttribute(overlay)}"></span>${media}<div class="wp-block-cover__inner-container">${children}</div></div>`,
    attributes.presentation,
    { attributes },
  );
}
