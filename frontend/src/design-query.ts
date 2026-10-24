import type { DesignBlock } from "./design-patterns";
import { escapeHtml } from "./design-patterns";
import { presentationHtml } from "./presentation";
import { safeContentUrl } from "./html";

/** Authorized, synchronously preloaded content; supplied by the caller's data layer. */
export interface DesignPostContext {
  id: number | string;
  /** Plain text, escaped when rendered as a native Post Title. */
  title: string;
  blocks: DesignBlock[];
  uri?: string;
  featuredImage?: { sourceUrl: string; altText: string } | null;
}

/** A producer-selected identity, not permission to fetch an arbitrary post. */
export interface DesignQueryItem {
  id: number | string;
  type?: string;
  slug?: string;
  uri?: string;
}

export interface DesignQueryResolverOptions {
  /** Map lookup or other synchronous lookup of already authorized, loaded posts. */
  resolvePost?: (item: DesignQueryItem) => DesignPostContext | null | undefined;
}

export interface DesignQueryRenderContext extends DesignQueryResolverOptions {
  post?: DesignPostContext;
  /** Use the same renderer and Site overrides recursively, under this post context. */
  render: (blocks: DesignBlock[], post?: DesignPostContext) => string;
  /** Optional Site URL normalization, followed by the shared safe-link boundary. */
  href?: (url: unknown) => string;
}

/** Repeat the delivered template once per delivered item, without selecting again.
 * Returns undefined for other blocks. No Query or synced-pattern shell is added.
 */
export function renderDesignQuery(
  block: DesignBlock,
  context: DesignQueryRenderContext,
): string | undefined {
  if (block.name !== "getquick-design/query") return undefined;
  const items = block.attributes.items;
  if (!Array.isArray(items)) throw new Error("Design Query requires producer-resolved items");
  return items
    .map((item: unknown) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("id" in item) ||
        (typeof item.id !== "number" && typeof item.id !== "string")
      ) {
        throw new Error("Design Query requires an item identity");
      }
      const post = context.resolvePost?.(item as DesignQueryItem);
      if (!post)
        throw new Error(`Design Query requires preloaded post context for item ${item.id}`);
      if (String(post.id) !== String(item.id))
        throw new Error(`Design Query item ${item.id} does not match its preloaded post context`);
      return context.render(block.children, post);
    })
    .join("");
}

/** Native post-dependent blocks and already-resolved synced references.
 * Call only after Site renderer overrides have had precedence.
 */
export function renderDesignPostBlock(
  block: DesignBlock,
  context: DesignQueryRenderContext,
): string | undefined {
  if (block.name === "core/block") return context.render(block.children, context.post);
  if (block.name !== "core/post-title" && block.name !== "core/post-content") return undefined;
  const post = context.post;
  if (!post) throw new Error(`${block.name} requires preloaded post context`);
  if (block.name === "core/post-content") {
    return presentationHtml(
      block.name,
      `<div class="wp-block-post-content">${context.render(post.blocks, post)}</div>`,
      block.attributes.presentation,
      { attributes: block.attributes },
    );
  }
  const level = block.attributes.level ?? 2;
  const tag =
    typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 6
      ? `h${level}`
      : level === 0
        ? "p"
        : "h2";
  let title = escapeHtml(post.title);
  if (block.attributes.isLink === true) {
    const href = safeContentUrl(context.href ? context.href(post.uri) : post.uri) || "#";
    const target =
      block.attributes.linkTarget === "_blank" ? ' target="_blank" rel="noopener noreferrer"' : "";
    title = `<a href="${escapeHtml(href)}"${target}>${title}</a>`;
  }
  return presentationHtml(
    block.name,
    `<${tag} class="wp-block-post-title">${title}</${tag}>`,
    block.attributes.presentation,
    { attributes: block.attributes },
  );
}

/** Find identities already selected by producers, including resolved patterns.
 * This never interprets query arguments or requests content. */
export function designQueryItems(
  pattern: { blocks: DesignBlock[] } | DesignBlock[] | null | undefined,
): DesignQueryItem[] {
  const result: DesignQueryItem[] = [];
  const visit = (blocks: DesignBlock[], depth: number) => {
    if (depth > 32) throw new RangeError("Design composition exceeds 32 levels");
    for (const block of blocks) {
      if (block.name === "getquick-design/query") {
        if (!Array.isArray(block.attributes.items))
          throw new Error("Design Query requires producer-resolved items");
        for (const item of block.attributes.items) {
          if (
            !item ||
            typeof item !== "object" ||
            (typeof item.id !== "string" && typeof item.id !== "number")
          )
            throw new Error("Design Query requires an item identity");
          result.push(item as DesignQueryItem);
        }
      }
      visit(block.children, depth + 1);
    }
  };
  if (pattern) visit(Array.isArray(pattern) ? pattern : pattern.blocks, 0);
  return result;
}

export interface DesignPostRecord {
  id: string | number;
  databaseId?: number;
  title: string;
  uri: string;
  designBlocks?: DesignBlock[];
  featuredImage?: { sourceUrl: string; altText: string } | null;
}

/** Convert an existing authorized publication; absent neutral delivery is explicit. */
export function designPostContext(record: DesignPostRecord): DesignPostContext | null {
  return record.designBlocks
    ? {
        id: record.databaseId ?? record.id,
        title: record.title,
        uri: record.uri,
        blocks: record.designBlocks,
        featuredImage: record.featuredImage,
      }
    : null;
}

export interface DesignPreloadedPosts extends DesignQueryResolverOptions {
  posts: ReadonlyMap<string, DesignPostContext>;
  resolvePost: (item: DesignQueryItem) => DesignPostContext | null;
}

/** Preload producer-selected URIs through a caller's existing publication loader.
 * Selection/order stay with the producer; nested contexts use the same boundary. */
export async function preloadDesignQueryPosts(
  pattern: { blocks: DesignBlock[] } | DesignBlock[] | null | undefined,
  load: (item: DesignQueryItem) => Promise<DesignPostRecord | null>,
): Promise<DesignPreloadedPosts> {
  const pending = [...designQueryItems(pattern)];
  const posts = new Map<string, DesignPostContext>();
  for (let index = 0; index < pending.length; index++) {
    if (index >= 5000) throw new RangeError("Design query preload exceeds 5000 items");
    const item = pending[index];
    if (!item.uri) throw new Error(`Design Query item ${item.id} requires a published URI`);
    const existing = posts.get(item.uri);
    if (existing) {
      if (String(existing.id) !== String(item.id))
        throw new Error(`Design Query item ${item.id} does not match its published post context`);
      continue;
    }
    const record = await load(item);
    const post = record && designPostContext(record);
    if (!post) throw new Error(`Design Query item ${item.id} has no published neutral content`);
    if (String(post.id) !== String(item.id))
      throw new Error(`Design Query item ${item.id} does not match its published post context`);
    posts.set(item.uri, post);
    pending.push(...designQueryItems(post.blocks));
  }
  return {
    posts,
    resolvePost: (item) => {
      const post = item.uri ? posts.get(item.uri) : undefined;
      return post && String(post.id) === String(item.id) ? post : null;
    },
  };
}
