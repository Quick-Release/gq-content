import { parseFragment } from "parse5";
import { escapeAttribute, safeContentUrl, rootAttributesHtml } from "./html";
import { presentationHtml, resolvePresentationToken } from "./presentation";

export const DESIGN_CAROUSEL = "getquick-design/sliders";
export const DESIGN_CAROUSEL_ITEM = "getquick-design/slider";
export const DESIGN_CAROUSEL_NAVIGATION = "getquick-design/carousel-navigation";
export interface DesignCarouselChild {
  name: string;
  attributes?: Record<string, unknown>;
  /** Complete rendered child HTML. Navigation is generated from its attributes. */
  html: string;
}

function replaceContent(shell: string, children: string, contentClass?: string): string {
  const fragment = parseFragment(shell, { sourceCodeLocationInfo: true });
  const root = fragment.childNodes.find((node) => "tagName" in node);
  if (!root || !("attrs" in root)) return shell;
  const target = contentClass
    ? root.childNodes.find(
        (node) =>
          "attrs" in node &&
          node.attrs.some(
            (attr) => attr.name === "class" && attr.value.split(/\s+/).includes(contentClass),
          ),
      )
    : root;
  if (
    !target ||
    !("tagName" in target) ||
    !target.sourceCodeLocation?.startTag ||
    !target.sourceCodeLocation.endTag
  )
    return shell;
  return (
    shell.slice(0, target.sourceCodeLocation.startTag.endOffset) +
    children +
    shell.slice(target.sourceCodeLocation.endTag.startOffset)
  );
}

/** Render an item's ordered content into its saved shell, or build its media
 * shell from neutral attributes. Saved media/link markup is retained exactly. */
export function renderDesignCarouselItem(
  attributes: Record<string, unknown>,
  children: string,
  shell?: string,
): string {
  let html = shell;
  if (!html) {
    const src = safeContentUrl(attributes.imageUrl);
    const href = safeContentUrl(attributes.linkUrl);
    const id =
      typeof attributes.imageId === "number" &&
      Number.isSafeInteger(attributes.imageId) &&
      attributes.imageId > 0
        ? ` class="wp-image-${attributes.imageId}"`
        : "";
    let image = src
      ? `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(typeof attributes.imageAlt === "string" ? attributes.imageAlt : "")}"${id}>`
      : "";
    if (image && href) image = `<a href="${escapeAttribute(href)}">${image}</a>`;
    html = `<figure class="wp-block-getquick-design-slider">${image}<div class="wp-block-getquick-design-slider__content">${children}</div></figure>`;
  } else if (children) {
    html = replaceContent(html, children, "wp-block-getquick-design-slider__content");
  }
  return presentationHtml(DESIGN_CAROUSEL_ITEM, html, attributes.presentation, { attributes });
}

function navigationHtml(attributes: Record<string, unknown>, count: number): string {
  if (attributes.visible === false) return "";
  const colors = [
    ["navigationBackgroundColor", "background"],
    ["arrowColor", "arrow"],
    ["indicatorColor", "indicator"],
  ]
    .flatMap(([property, target]) => {
      const value = attributes[property];
      const css =
        typeof value === "string"
          ? resolvePresentationToken("color", { literal: value })
          : undefined;
      return css ? [`--gqd-navigation-${target}:${css}`] : [];
    })
    .join(";");
  const arrows =
    attributes.showArrows === false
      ? ""
      : '<button type="button" data-gqd-previous aria-label="Previous slide">&#8592;</button><button type="button" data-gqd-next aria-label="Next slide">&#8594;</button>';
  const indicators = Array.from(
    { length: count },
    (_, index) =>
      `<button type="button" data-gqd-go="${index}" aria-label="Go to slide ${index + 1}"${index === 0 ? ' aria-current="true"' : ""}><span aria-hidden="true">${attributes.navigationType === "lines" ? "&#8212;" : "&#9679;"}</span></button>`,
  ).join("");
  return presentationHtml(
    DESIGN_CAROUSEL_NAVIGATION,
    `<nav class="wp-block-getquick-design-carousel-navigation" aria-label="Carousel navigation"${colors ? ` style="${escapeAttribute(colors)}"` : ""} data-gqd-position="${attributes.navigationPosition === "outside" ? "outside" : "inside"}">${arrows}<div data-gqd-indicators>${indicators}</div></nav>`,
    attributes.presentation,
    { attributes },
  );
}

/** Complete Carousel markup shared by Sites, pattern chrome and parsed content.
 * Children are already rendered by the Site; exactly one navigation child is required. */
export function renderDesignCarousel(
  attributes: Record<string, unknown>,
  children: DesignCarouselChild[],
  shell?: string,
): string {
  const navigations = children.filter((child) => child.name === DESIGN_CAROUSEL_NAVIGATION);
  if (navigations.length !== 1)
    throw new TypeError("Carousel requires exactly one navigation child");
  const settings = navigations[0].attributes ?? {};
  const count = children.filter((child) => child.name === DESIGN_CAROUSEL_ITEM).length;
  const duration = settings.slideDuration === undefined ? 5 : settings.slideDuration;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 120)
    throw new TypeError("Carousel slideDuration must be 1–120 seconds");
  const body = children
    .map((child) =>
      child.name === DESIGN_CAROUSEL_NAVIGATION
        ? navigationHtml(child.attributes ?? {}, count)
        : child.html,
    )
    .join("");
  const html = shell
    ? replaceContent(shell, body)
    : `<div class="wp-block-getquick-design-sliders">${body}</div>`;
  return rootAttributesHtml(
    presentationHtml(DESIGN_CAROUSEL, html, attributes.presentation, { attributes }),
    {
      "data-gqd-carousel": "",
      "data-gqd-autoplay": String(settings.autoplay === true),
      "data-gqd-duration": String(duration),
    },
    {
      role: "region",
      "aria-roledescription": "carousel",
      "aria-label": typeof attributes.ariaLabel === "string" ? attributes.ariaLabel : "Carousel",
    },
  );
}

/** Structural styles only; canonical presentation CSS supplies authored values. */
export function designCarouselStyle(): string {
  return `.wp-block-getquick-design-sliders{position:relative;display:grid;isolation:isolate}.wp-block-getquick-design-sliders>.wp-block-getquick-design-slider{grid-area:1/1;position:relative;min-width:0;min-height:0;margin:0}.wp-block-getquick-design-sliders>.wp-block-getquick-design-slider>a{display:block;width:100%;height:100%}.wp-block-getquick-design-sliders>.wp-block-getquick-design-slider>img,.wp-block-getquick-design-sliders>.wp-block-getquick-design-slider>a>img{display:block;width:100%;height:100%;object-fit:cover}.wp-block-getquick-design-slider__content{position:relative;z-index:1}.wp-block-getquick-design-slider:has(>img)>.wp-block-getquick-design-slider__content,.wp-block-getquick-design-slider:has(>a>img)>.wp-block-getquick-design-slider__content{position:absolute;inset:0}[data-gqd-carousel].wp-block-getquick-design-sliders>[data-gqd-slide].wp-block-getquick-design-slider[hidden]{display:none!important}.wp-block-getquick-design-carousel-navigation{background:var(--gqd-navigation-background,transparent);display:flex;align-items:center;gap:1rem;z-index:2}.wp-block-getquick-design-carousel-navigation[data-gqd-position=inside]{position:absolute;inset-inline:0;bottom:0}.wp-block-getquick-design-carousel-navigation[data-gqd-position=outside]{grid-column:1;grid-row:2}.wp-block-getquick-design-carousel-navigation [data-gqd-indicators]{display:flex;gap:.5rem}.wp-block-getquick-design-sliders>.wp-block-getquick-design-carousel-navigation [data-gqd-previous],.wp-block-getquick-design-sliders>.wp-block-getquick-design-carousel-navigation [data-gqd-next]{color:var(--gqd-navigation-arrow,inherit)}.wp-block-getquick-design-sliders>.wp-block-getquick-design-carousel-navigation [data-gqd-go]{color:var(--gqd-navigation-indicator,inherit)}.wp-block-getquick-design-carousel-navigation button:focus-visible{outline:2px solid currentColor;outline-offset:2px}`;
}
