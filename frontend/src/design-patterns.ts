import type { SiteChrome, WordPressMenuItem } from "./content-types";
import {
  renderWordPressBlocks,
  type BlockRenderOptions,
  type WordPressBlock,
} from "./wp-block-renderer";

/**
 * GQ Design's built-in design routes (GETQUICK → Design → Header & Footer),
 * each with its own header and footer selection. GQ Design's template
 * selection contract (docs/template-selection.md, 0.4.2) says which one a
 * kind of content is served with: see `designRouteKey`.
 */
export const DESIGN_ROUTE_KEYS = [
  "front-page",
  "home",
  "single-post",
  "page",
  "single",
  "archive",
  "search",
] as const;

export type DesignRouteKey = (typeof DESIGN_ROUTE_KEYS)[number];

/**
 * What a page shows, as WordPress resolves it:
 *
 * - `entry`: a post, page or entry of another public post type, with
 *   WordPress's `isFrontPage` and `isPostsPage` flags when it is a page;
 * - `front-page`: the site's front page, whatever it shows (a static page,
 *   or the latest posts when no static front page is set);
 * - `archive`: a listing (a category, tag, custom taxonomy, post type,
 *   author or date archive);
 * - `search`: search results;
 * - `not-found`: nothing (a 404), or anything else.
 */
export type DesignRouteContent =
  | { kind: "entry"; postType: string; isFrontPage?: boolean; isPostsPage?: boolean }
  | { kind: "front-page" }
  | { kind: "archive" }
  | { kind: "search" }
  | { kind: "not-found" };

/**
 * The design route a page is served with: the first row of GQ Design's
 * contract that matches it. The front page is `front-page`; the posts index
 * of a site with a static front page is `home`; a post is `single-post`, a
 * page `page`, and an entry of any other public post type `single`; a
 * listing is `archive`, search results `search`; a 404, or anything else, is
 * `page`. GQ Design before 0.4.2 has no `single` or `search` route: they read
 * as unselected there, so those pages keep the Site's own chrome.
 */
export function designRouteKey(content: DesignRouteContent): DesignRouteKey {
  switch (content.kind) {
    case "front-page":
      return "front-page";
    case "archive":
      return "archive";
    case "search":
      return "search";
    case "not-found":
      return "page";
    case "entry":
      if (content.isFrontPage) return "front-page";
      if (content.isPostsPage) return "home";
      if (content.postType === "post") return "single-post";
      if (content.postType === "page") return "page";
      return "single";
  }
}

/** Whether a value is one of GQ Design's built-in route keys. */
export function isDesignRouteKey(value: unknown): value is DesignRouteKey {
  return (DESIGN_ROUTE_KEYS as readonly unknown[]).includes(value);
}

/**
 * The published synced pattern GQ Design's Header & Footer selects for a
 * route's header or footer (`designPattern`): its title, and its blocks as
 * the Frontend renders content blocks, with nested patterns inlined.
 */
export interface DesignPattern {
  title: string;
  blocks: WordPressBlock[];
}

/** A route's selection: either region is absent where it uses an ordinary template part. */
export interface DesignRoutePatterns {
  header?: DesignPattern;
  footer?: DesignPattern;
}

/** Each route's selection, as the chrome stores it: only routes with a pattern are listed. */
export type DesignPatterns = Partial<Record<DesignRouteKey, DesignRoutePatterns>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The wrapper WordPress saves around a container's inner blocks, which GQ
 * Design leaves out (it sends saved HTML only for blocks without children):
 * its element (`tagName`), its block class (`wp-block-group` for
 * `core/group`, `wp-block-getquick-design-container` for a container), and
 * the classes WordPress saves for `className`, `align` and preset colours.
 * Saved inline styles (custom colours, spacing) aren't in the layout API, so
 * they need a Site renderer.
 */
function containerShell(name: string, attributes: Record<string, unknown>): string {
  const { tagName, className, align, backgroundColor, textColor } = attributes;
  const tag = typeof tagName === "string" && CONTAINER_TAGS.has(tagName) ? tagName : "div";
  const classes = [`wp-block-${name.replace(/^core\//, "").replaceAll("/", "-")}`];
  if (typeof className === "string" && className.trim()) classes.push(className.trim());
  if (typeof align === "string" && SLUG.test(align)) classes.push(`align${align}`);
  if (typeof textColor === "string" && SLUG.test(textColor)) {
    classes.push(`has-${textColor}-color`, "has-text-color");
  }
  if (typeof backgroundColor === "string" && SLUG.test(backgroundColor)) {
    classes.push(`has-${backgroundColor}-background-color`, "has-background");
  }
  return `<${tag} class="${escapeAttribute(classes.join(" "))}"></${tag}>`;
}

/**
 * A GQ Design layout node (`{ name, attributes, content, children,
 * supported }`) as a content block: `content`, the HTML WordPress saved for a
 * block without children (null for a dynamic block), is its `htmlContent`; a
 * block with children gets the wrapper WordPress saves for it; `children` are
 * its inner blocks. Unsupported blocks are reported: GQ Design leaves their
 * attributes out.
 */
function nodeBlock(value: unknown, unsupported: Set<string>): WordPressBlock | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name) return null;
  if (value.supported === false) unsupported.add(value.name);
  // PHP encodes empty attributes as `[]` or `{}`; anything but an object has none.
  const attributes = isRecord(value.attributes) ? value.attributes : {};
  const innerBlocks = Array.isArray(value.children)
    ? value.children
        .map((child) => nodeBlock(child, unsupported))
        .filter((block): block is WordPressBlock => block !== null)
    : [];
  return {
    name: value.name,
    attributes,
    htmlContent:
      typeof value.content === "string"
        ? value.content
        : innerBlocks.length > 0
          ? containerShell(value.name, attributes)
          : "",
    innerBlocks,
  };
}

/**
 * A pattern's `blocksJson` (JSON text) as content blocks, and the names of the
 * blocks GQ Design says it doesn't support. Undefined when it isn't a JSON
 * list of blocks.
 */
export function parseDesignBlocks(
  blocksJson: unknown,
): { blocks: WordPressBlock[]; unsupported: string[] } | undefined {
  let parsed = blocksJson;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed)) return undefined;
  const unsupported = new Set<string>();
  const blocks = parsed
    .map((node) => nodeBlock(node, unsupported))
    .filter((block): block is WordPressBlock => block !== null);
  return { blocks, unsupported: [...unsupported] };
}

/**
 * The chrome a page on a route is served with: the stored chrome with that
 * route's header and footer, and without the other routes'. A route without
 * a selection (or chrome stored by a CMS without GQ Design's Header & Footer)
 * has neither, so the Site keeps its own header and footer.
 */
export function chromeForRoute(chrome: SiteChrome, route: DesignRouteKey): SiteChrome {
  const { designPatterns, header: _, footer: __, ...rest } = chrome;
  const selected = designPatterns?.[route];
  return {
    ...rest,
    ...(selected?.header ? { header: selected.header } : {}),
    ...(selected?.footer ? { footer: selected.footer } : {}),
  };
}

function renderRegion(
  pattern: DesignPattern | undefined,
  tag: "header" | "footer",
  options: BlockRenderOptions,
): string | null {
  if (!pattern) return null;
  return `<${tag} class="gq-site-${tag}">${renderWordPressBlocks(pattern.blocks, options)}</${tag}>`;
}

/**
 * The page's header as an editor designed it in GETQUICK → Design → Header &
 * Footer: its pattern's blocks rendered by `renderWordPressBlocks`, with the
 * Site's renderers, in a `<header class="gq-site-header">`. Null when the
 * page's route has no header pattern (or there is no chrome): the Site's
 * layout keeps its own header, the logo and the primary menu, unchanged.
 */
export function renderSiteHeader(
  chrome: SiteChrome | null | undefined,
  options: BlockRenderOptions = {},
): string | null {
  return renderRegion(chrome?.header, "header", options);
}

/**
 * The page's footer as an editor designed it, in a `<footer
 * class="gq-site-footer">`, as `renderSiteHeader` renders the header. Null
 * when the page's route has no footer pattern: the Site keeps its own.
 */
export function renderSiteFooter(
  chrome: SiteChrome | null | undefined,
  options: BlockRenderOptions = {},
): string | null {
  return renderRegion(chrome?.footer, "footer", options);
}

/** A link from a pattern as served: http(s), mailto, tel, a path or a fragment; else "#". */
function safeHref(url: unknown): string {
  if (typeof url !== "string" || !url.trim()) return "#";
  const href = url.trim();
  if (/^\/(?!\/)/.test(href) || href.startsWith("#") || href.startsWith("?")) return href;
  try {
    const { protocol } = new URL(href);
    return ["https:", "http:", "mailto:", "tel:"].includes(protocol) ? href : "#";
  } catch {
    return "#";
  }
}

/**
 * A menu-backed block's `menuItems` (GQ Design fills them from the block's
 * classic menu: a flat list in menu order of `{ id, parentId, label, url,
 * target }`, `parentId` 0 at the top level, same-site URLs root-relative) as
 * the tree the chrome's own menu is, for a Site renderer such as
 * `getquick/header-navigation`'s. Items without an id or a label are left out;
 * one whose parent isn't listed is a top-level item; a link that isn't a
 * path or an http(s), mailto or tel URL becomes "#".
 */
export function designMenuItems(menuItems: unknown): WordPressMenuItem[] {
  if (!Array.isArray(menuItems)) return [];
  const key = (value: unknown) =>
    typeof value === "number" || typeof value === "string" ? String(value) : "";
  const byId = new Map<string, WordPressMenuItem>();
  const parentOf = new Map<string, string>();
  for (const item of menuItems) {
    if (!isRecord(item)) continue;
    const id = key(item.id);
    const label = typeof item.label === "string" ? item.label : "";
    if (!id || !label || byId.has(id)) continue;
    const parentId = key(item.parentId);
    if (parentId && parentId !== "0" && parentId !== id) parentOf.set(id, parentId);
    byId.set(id, {
      id,
      label,
      href: safeHref(item.url),
      target: item.target === "_blank" ? "_blank" : null,
      children: [],
    });
  }
  // Each item comes after its parent, so a parent listed later (or a cycle)
  // makes a top-level item, and the tree stays finite.
  const placed = new Set<string>();
  const roots: WordPressMenuItem[] = [];
  for (const [id, item] of byId) {
    const parentId = parentOf.get(id);
    const parent = parentId !== undefined && placed.has(parentId) ? byId.get(parentId) : undefined;
    (parent ? parent.children : roots).push(item);
    placed.add(id);
  }
  return roots;
}
