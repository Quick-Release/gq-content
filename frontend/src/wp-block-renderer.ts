import { DESIGN_NAVIGATION_BLOCKS, renderDesignNavigation } from "./design-navigation";
import { renderDesignText } from "./design-text";
import { renderDesignImage } from "./design-image";
import { renderDesignVideoHero, VIDEO_HERO_BLOCK } from "./design-video";
export { VIDEO_HERO_BLOCK, youtubeVideoId } from "./design-video";
import {
  DESIGN_CAROUSEL,
  DESIGN_CAROUSEL_ITEM,
  DESIGN_CAROUSEL_NAVIGATION,
  renderDesignCarousel,
  renderDesignCarouselItem,
} from "./carousel";
import { DESIGN_GRID, gridLayoutHtml } from "./wp-grid-layout";
import { presentationHtml } from "./presentation";

export interface WordPressBlock {
  name: string;
  attributes?: Record<string, unknown>;
  htmlContent?: string;
  /** Complete server-rendered HTML; htmlContent may be only a container shell. */
  dynamicContent?: string;
  innerBlocks?: WordPressBlock[];
}

const BLOCKS_WITH_RENDERED_CHILDREN = new Set([
  "core/cover",
  "core/media-text",
  "core/navigation",
  "core/navigation-submenu",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBlock(value: unknown): WordPressBlock | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;

  const attributes = isRecord(value.attributes) ? value.attributes : undefined;
  const innerBlocks = Array.isArray(value.innerBlocks)
    ? value.innerBlocks
        .map(normalizeBlock)
        .filter((block): block is WordPressBlock => block !== null)
    : [];

  return {
    name: value.name,
    attributes,
    htmlContent: typeof value.htmlContent === "string" ? value.htmlContent : "",
    dynamicContent: typeof value.dynamicContent === "string" ? value.dynamicContent : undefined,
    innerBlocks,
  };
}

export function parseWordPressBlocks(value: unknown): WordPressBlock[] {
  let parsed = value;

  // WPGraphQL's JSON scalar may arrive either as JSON data or JSON-encoded text.
  for (let attempt = 0; attempt < 2 && typeof parsed === "string"; attempt += 1) {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeBlock).filter((block): block is WordPressBlock => block !== null);
}

export function hasDesignCarousel(blocks: WordPressBlock[]): boolean {
  return blocks.some(
    (block) => block.name === DESIGN_CAROUSEL || hasDesignCarousel(block.innerBlocks ?? []),
  );
}

export function hasVideoHero(blocks: WordPressBlock[]): boolean {
  return blocks.some(
    (block) => block.name === VIDEO_HERO_BLOCK || hasVideoHero(block.innerBlocks ?? []),
  );
}

function appendChildren(html: string, children: string): string {
  if (!children) return html;
  const closingTag = html.lastIndexOf("</");
  if (closingTag < 0) return `${html}${children}`;
  return `${html.slice(0, closingTag)}${children}${html.slice(closingTag)}`;
}

function renderBlock(block: WordPressBlock): string {
  if (block.name === DESIGN_CAROUSEL)
    return renderDesignCarousel(
      block.attributes ?? {},
      (block.innerBlocks ?? []).map((child) => ({
        name: child.name,
        attributes: child.attributes,
        html: child.name === DESIGN_CAROUSEL_NAVIGATION ? "" : renderBlock(child),
      })),
      block.htmlContent || undefined,
    );
  if (block.name === DESIGN_CAROUSEL_ITEM)
    return renderDesignCarouselItem(
      block.attributes ?? {},
      (block.innerBlocks ?? []).map((child) => renderBlock(child)).join(""),
      block.htmlContent || undefined,
    );
  let html = presentationHtml(
    block.name,
    (BLOCKS_WITH_RENDERED_CHILDREN.has(block.name) ? block.dynamicContent : undefined) ||
      block.htmlContent ||
      "",
    block.attributes?.presentation,
    { attributes: block.attributes },
  );
  if (block.name === DESIGN_GRID) html = gridLayoutHtml(html, block.attributes ?? {});
  const children = (block.innerBlocks ?? []).map((child) => renderBlock(child)).join("");

  if (block.name === VIDEO_HERO_BLOCK)
    return renderDesignVideoHero(block.attributes ?? {}, children, block.htmlContent || undefined);

  if (DESIGN_NAVIGATION_BLOCKS.has(block.name))
    return renderDesignNavigation(block.name, block.attributes ?? {}, children, html);
  if (block.name === "core/image")
    return renderDesignImage(block.attributes ?? {}, html || undefined);
  if (!html) {
    const text = renderDesignText(block.name, block.attributes ?? {}, children);
    if (text !== undefined) return text;
  }
  if (!children || BLOCKS_WITH_RENDERED_CHILDREN.has(block.name)) return html;
  return appendChildren(html, children);
}

export function renderWordPressBlocks(blocks: WordPressBlock[]): string {
  return blocks.map((block) => renderBlock(block)).join("");
}
