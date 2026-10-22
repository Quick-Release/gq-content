import type { WordPressMenuItem } from "./content-types";
import { menuItemHref } from "./formatting";
import { containerChildLayoutHtml, containerLayoutHtml } from "./wp-container-layout";

/**
 * A block of a GQ Design pattern, as its layout API shapes it (`blocksJson`):
 * its name, its public attributes (including those a Site's serializer adds,
 * such as `getquick/header-navigation`'s `menuItems`), the HTML WordPress saved
 * for it (null for a dynamic block, such as `core/site-logo`), and its inner
 * blocks, with synced patterns already inlined.
 */
export interface DesignBlock {
  name: string;
  attributes: Record<string, unknown>;
  content: string | null;
  children: DesignBlock[];
}

/**
 * The published synced pattern GQ Design's Header & Footer selects for a
 * region of the Site chrome (`designPattern`), as its block tree.
 */
export interface DesignPattern {
  title: string;
  blocks: DesignBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A complete pattern tree from JSON text or a parsed list. Malformed nodes
 * fail the whole read: dropping one could promote a partial header or footer.
 * PHP's empty attributes (`[]`) normalize to an object.
 */
export function parseDesignBlocks(value: unknown): DesignBlock[] | undefined {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  let count = 0;
  const blocks = (value: unknown, depth: number): DesignBlock[] | undefined => {
    // The provider's resolver bounds trees to 32 levels and 1000 nodes.
    if (!Array.isArray(value) || (value.length > 0 && depth > 32)) return undefined;
    const result: DesignBlock[] = [];
    for (const item of value) {
      if (++count > 1000 || !isRecord(item) || typeof item.name !== "string" || !item.name)
        return undefined;
      const attributes = isRecord(item.attributes)
        ? item.attributes
        : Array.isArray(item.attributes) && item.attributes.length === 0
          ? {}
          : undefined;
      if (!attributes || (item.content !== null && typeof item.content !== "string"))
        return undefined;
      const children = blocks(item.children, depth + 1);
      if (!children) return undefined;
      result.push({ name: item.name, attributes, content: item.content, children });
    }
    return result;
  };
  return blocks(parsed, 0);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** What a block renderer is given besides its block. */
export interface DesignRenderContext {
  /** The block's children, rendered in order by the same renderers (when read). */
  children: string;
  /** The blocks it is inside, outermost first. */
  ancestors: DesignBlock[];
  /** Renders other blocks (a subset of the children, say) by the same renderers. */
  render(this: void, blocks: DesignBlock[]): string;
  /**
   * A link from CMS data as the Frontend serves it: one into this Site (the
   * CMS or the Site origin) becomes its path, another http(s) link stays
   * absolute, and anything else (`javascript:`, say) becomes "#".
   */
  href(this: void, url: unknown): string;
  /** The home page of the language being served ("/" unless the options say). */
  home: string;
}

/**
 * Renders one block as HTML. Its output is not escaped again: escape what the
 * CMS supplied (`escapeHtml`) and pass links through `context.href`.
 */
export type DesignBlockRenderer = (block: DesignBlock, context: DesignRenderContext) => string;

export interface DesignRenderOptions {
  /**
   * The Site's renderers, by block name: its own blocks (such as
   * `getquick/header-navigation`), and any core block it renders itself.
   * They take precedence over the built-in ones.
   */
  blocks?: Record<string, DesignBlockRenderer>;
  /** The origins whose links are this Site's: the CMS's and the Site's. */
  internalOrigins?: string[];
  /**
   * Told about each block without children that has neither a renderer nor
   * saved HTML (a dynamic block): it renders nothing.
   */
  onUnrendered?: (block: DesignBlock) => void;
  /** The home page of the language being served, for home links: "/" by default. */
  home?: string;
}

/** Inserts children before the HTML's last closing tag, where WordPress's wrappers keep them. */
function insertChildren(html: string, children: string): string {
  if (!children) return html;
  const closingTag = html.lastIndexOf("</");
  if (closingTag < 0) return `${html}${children}`;
  return `${html.slice(0, closingTag)}${children}${html.slice(closingTag)}`;
}

function linkHref(url: unknown, internalOrigins: string[]): string {
  if (typeof url !== "string" || !url.trim()) return "#";
  const href = internalOrigins.length > 0 ? menuItemHref(url.trim(), internalOrigins) : url.trim();
  if (/^\/(?!\/)/.test(href) || href.startsWith("#") || href.startsWith("?")) return href;
  try {
    const protocol = new URL(href).protocol;
    return protocol === "https:" ||
      protocol === "http:" ||
      protocol === "mailto:" ||
      protocol === "tel:"
      ? href
      : "#";
  } catch {
    return "#";
  }
}

interface DesignLogo {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** A media URL as an image source: http(s) only, never another scheme. */
function mediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function designLogo(value: unknown): DesignLogo | null {
  const url = isRecord(value) ? mediaUrl(value.url) : null;
  if (!isRecord(value) || !url) return null;
  const size = (item: unknown) => (typeof item === "number" && item > 0 ? item : null);
  return {
    url,
    alt: typeof value.alt === "string" ? value.alt : "",
    width: size(value.width),
    height: size(value.height),
  };
}

/**
 * GQ Design's Site Logo node carries the Branding logo itself (`logo`, null
 * when unset) and its authored `width`, `isLink` and `linkTarget`, so it
 * renders without another read. Without a logo, nothing: the Site's own
 * renderer can show its title instead.
 */
const renderSiteLogo: DesignBlockRenderer = (block, context) => {
  const logo = designLogo(block.attributes.logo);
  if (!logo) return "";
  const width = typeof block.attributes.width === "number" ? block.attributes.width : logo.width;
  const size = [
    width ? ` width="${width}"` : "",
    width && logo.width && logo.height
      ? ` height="${Math.round((width * logo.height) / logo.width)}"`
      : !width && logo.height
        ? ` height="${logo.height}"`
        : "",
  ].join("");
  const image = `<img class="custom-logo" src="${escapeHtml(logo.url)}" alt="${escapeHtml(logo.alt)}"${size} decoding="async" />`;
  const className =
    typeof block.attributes.className === "string" ? ` ${block.attributes.className}` : "";
  const linked =
    block.attributes.isLink === false
      ? image
      : `<a href="${escapeHtml(context.href(context.home))}" class="custom-logo-link" ${block.attributes.linkTarget === "_blank" ? 'target="_blank" rel="home noopener"' : 'rel="home"'}>${image}</a>`;
  return `<div class="wp-block-site-logo${escapeHtml(className)}">${linked}</div>`;
};

const BUILT_IN: Record<string, DesignBlockRenderer> = { "core/site-logo": renderSiteLogo };

/** The elements a container's `tagName` may choose, as WordPress's Group block offers them. */
const CONTAINER_TAGS = new Set([
  "div",
  "header",
  "footer",
  "main",
  "section",
  "article",
  "aside",
  "nav",
]);
const SLUG = /^[a-z0-9-]+$/;
/** GQ Design's layout container, whose width, gap and padding content also restores. */
const DESIGN_CONTAINER = "getquick-design/container";

/**
 * A container block (one with children) as WordPress wraps it. GQ Design
 * sends saved HTML only for blocks without children, so a container's wrapper
 * is rebuilt from its name and attributes: its element (`tagName`), its default
 * class (`wp-block-group` for `core/group`, `wp-block-acme-hero` for
 * `acme/hero`), and the classes WordPress derives from `className`, `align`,
 * its preset colours and its layout type. Other styles (custom colours,
 * spacing) need a Site renderer. GQ Design's own container
 * (`getquick-design/container`) also gets its layout, as in content.
 */
function containerHtml(block: DesignBlock, children: string): string {
  const { tagName, className, align, backgroundColor, textColor, layout } = block.attributes;
  const tag = typeof tagName === "string" && CONTAINER_TAGS.has(tagName) ? tagName : "div";
  const classes = [`wp-block-${block.name.replace(/^core\//, "").replaceAll("/", "-")}`];
  if (typeof className === "string" && className.trim()) classes.push(className.trim());
  if (typeof align === "string" && SLUG.test(align)) classes.push(`align${align}`);
  if (typeof backgroundColor === "string" && SLUG.test(backgroundColor)) {
    classes.push(`has-${backgroundColor}-background-color`, "has-background");
  }
  if (typeof textColor === "string" && SLUG.test(textColor)) {
    classes.push(`has-${textColor}-color`, "has-text-color");
  }
  const layoutType = isRecord(layout) ? layout.type : undefined;
  if (typeof layoutType === "string" && SLUG.test(layoutType))
    classes.push(`is-layout-${layoutType}`);
  return `<${tag} class="${escapeHtml(classes.join(" "))}">${children}</${tag}>`;
}

/**
 * A pattern (or blocks of one) as HTML. Each block is rendered by the Site's
 * renderer for its name, else a built-in one, else as the HTML WordPress saved
 * for it, else, with children, as a WordPress container wrapping them. A block
 * with none of those (a dynamic block, such as a Site's own) renders nothing
 * and is reported to `onUnrendered`. Null renders nothing, so the Site keeps
 * its own header or footer.
 */
export function renderDesignPattern(
  pattern: DesignPattern | DesignBlock[] | null | undefined,
  options: DesignRenderOptions = {},
): string {
  if (!pattern) return "";
  const renderers = { ...BUILT_IN, ...options.blocks };
  const internalOrigins = options.internalOrigins ?? [];
  const href = (url: unknown) => linkHref(url, internalOrigins);

  // `parentContainer`: the wrapper of the GQ Design container a block is
  // directly inside, whose layout it continues, as content's renderer does.
  const renderAll = (
    blocks: DesignBlock[],
    ancestors: DesignBlock[],
    parentContainer = "",
  ): string => blocks.map((block) => renderOne(block, ancestors, parentContainer)).join("");

  function renderOne(
    block: DesignBlock,
    ancestors: DesignBlock[],
    parentContainer: string,
  ): string {
    const inside = [...ancestors, block];
    const renderer = Object.hasOwn(renderers, block.name) ? renderers[block.name] : undefined;
    if (renderer) {
      // Rendered when the renderer asks for them, once.
      let children: string | undefined;
      return renderer(block, {
        get children() {
          return (children ??= renderAll(block.children, inside));
        },
        ancestors,
        render: (blocks) => renderAll(blocks, inside),
        href,
        home: options.home ?? "/",
      });
    }
    if (block.name === DESIGN_CONTAINER && (block.children.length > 0 || block.content !== null)) {
      // The same layout content's containers get (constrained width, gap and
      // padding), from the shared adapter rather than a copy of it. An empty
      // one is a leaf without HTML, reported like any other.
      let wrapper = containerLayoutHtml(
        block.content ?? containerHtml(block, ""),
        block.attributes,
      );
      if (parentContainer) wrapper = containerChildLayoutHtml(wrapper, parentContainer);
      return insertChildren(wrapper, renderAll(block.children, inside, wrapper));
    }
    const children = renderAll(block.children, inside);
    if (block.content !== null) return insertChildren(block.content, children);
    if (block.children.length > 0) return containerHtml(block, children);
    options.onUnrendered?.(block);
    return "";
  }

  return renderAll(Array.isArray(pattern) ? pattern : pattern.blocks, []);
}

/**
 * A menu a Site block carries in its attributes (a flat list of `{ id,
 * parentId, label, url, target }`, as GQ Design's serializer filter documents
 * for `getquick/header-navigation`) as a tree, with each link as the
 * Frontend serves it. Items that aren't menu items are left out; one whose
 * parent isn't listed, or that is in a cycle of parents, is a top-level item.
 */
export function designMenuItems(
  value: unknown,
  href: (url: unknown) => string = (url) => linkHref(url, []),
): WordPressMenuItem[] {
  if (!Array.isArray(value)) return [];
  const id = (item: unknown) =>
    typeof item === "number" || typeof item === "string" ? String(item) : "";
  const seen = new Set<string>();
  const items = value.filter(isRecord).filter((item) => {
    const key = id(item.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const byId = new Map<string, WordPressMenuItem>();
  const parentOf = new Map<string, string>();
  for (const item of items) {
    const parentId = id(item.parentId);
    if (parentId && parentId !== "0") parentOf.set(id(item.id), parentId);
    byId.set(id(item.id), {
      id: id(item.id),
      label: typeof item.label === "string" ? item.label : "",
      href: href(item.url),
      target: item.target === "_blank" ? "_blank" : null,
      children: [],
    });
  }
  // An item in a cycle of parents is a top-level item, so the tree stays
  // finite. One whose ancestors reach a cycle it isn't part of keeps its
  // parent (that cycle's items are the top-level ones).
  const inCycle = (start: string) => {
    const visited = new Set<string>();
    for (let at = parentOf.get(start); at !== undefined; at = parentOf.get(at)) {
      if (at === start) return true;
      if (visited.has(at)) return false;
      visited.add(at);
    }
    return false;
  };
  const roots: WordPressMenuItem[] = [];
  for (const [key, node] of byId) {
    const parentId = parentOf.get(key);
    const parent = parentId !== undefined && !inCycle(key) ? byId.get(parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}
