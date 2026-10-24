/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { parseFragment } from "parse5";
import { parseDesignBlocks, renderDesignPattern, type DesignBlock } from "@getquick/content";
import {
  renderDesignQuery,
  renderDesignPostBlock,
  type DesignPostContext,
  type DesignQueryRenderContext,
} from "@getquick/content";

// Verbatim public WordPress fixture at gq-design 6b5f746.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/query-composition/public.json", import.meta.url), "utf8"),
);
const query = parseDesignBlocks(fixture.blocks)![0];
const beta = fixture.items[0].id;
const gamma = fixture.items[1].id;
const posts = new Map<number | string, DesignPostContext>(
  fixture.items.map((item: { id: number; title: string; blocks: unknown }) => [
    item.id,
    {
      id: item.id,
      title: item.title,
      blocks: parseDesignBlocks(item.blocks)!,
    },
  ]),
);

test("repeats the producer's selected Beta/Gamma contexts exactly once despite offset one", () => {
  const html = renderDesignQuery(query, {
    resolvePost: (item) => posts.get(item.id),
    render: (_blocks, post) => `<article>${post!.title}</article>`,
  });
  expect(html).toBe("<article>Beta</article><article>Gamma</article>");
});

// Parent-owned integration seam: production render paths remain untouched here.
function render(blocks: DesignBlock[], post?: DesignPostContext): string {
  return renderDesignPattern(blocks, { post, resolvePost: (item) => posts.get(item.id) });
}

test("composes the real public item pattern with each item's recursive body and transparent synced references", () => {
  const html = render([query]);
  expect(html).toMatch(/<h2[^>]*>Beta<\/h2>/);
  expect(html).toMatch(/<h2[^>]*>Gamma<\/h2>/);
  expect(html.indexOf("Beta content")).toBeLessThan(html.indexOf("Gamma content"));
  expect(html.match(/Nested item body/g)).toHaveLength(2);
  expect(html.match(/Pattern details/g)).toHaveLength(2);
  expect(html.match(/href="#details"/g)).toHaveLength(2);
  expect(html).not.toContain("wp-block-block");
  expect(html).not.toContain("wp-block-getquick-design-query");
  expect(html).toContain("--gqd-base-fontSize:var(--gqd-text-2xl, 1.5rem)");
  expect(html).toContain("--gqd-md-gridColumns:repeat(2, minmax(0, 1fr))");
  expect(html).toContain("--gqd-base-gap");
  expect(html).toContain("--gqd-base-paddingInline:calc(var(--gqd-spacing, 0.25rem) * 4)");
  expect(html).toContain("--gqd-base-borderRadius:var(--gqd-radius-lg, 0.5rem)");
  const roots = parseFragment(html).childNodes.filter((node) => "tagName" in node);
  expect(roots.map((node) => node.tagName)).toEqual(["h2", "div", "div", "h2", "div", "div"]);
  const body = roots[1].childNodes.filter((node) => "tagName" in node);
  expect(body.map((node) => node.tagName)).toEqual(["p", "p"]);
  const grid = roots[2].childNodes.filter((node) => "tagName" in node);
  expect(grid.map((node) => node.tagName)).toEqual(["div", "div"]);
});

test("native linked titles escape text and normalized URLs and reject executable links", () => {
  const title: DesignBlock = {
    name: "core/post-title",
    attributes: { level: 3, isLink: true, linkTarget: "_blank" },
    content: null,
    children: [],
  };
  const post: DesignPostContext = {
    id: 1,
    title: '<img src=x> & "title"',
    uri: "https://cms.test/item/",
    blocks: [],
  };
  const html = renderDesignPostBlock(title, { post, render, href: () => '/item/?a="x"&b=2' });
  expect(html).toContain('<h3 class="wp-block-post-title');
  expect(html).toContain("&lt;img src=x&gt; &amp; &quot;title&quot;");
  expect(html).toContain('href="/item/?a=&quot;x&quot;&amp;b=2"');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(
    renderDesignPostBlock(title, { post: { ...post, uri: "javascript:alert(1)" }, render }),
  ).toContain('href="#"');
});

test("preserves producer order and duplicate identities even when query selection attributes disagree", () => {
  const block = structuredClone(query);
  block.attributes = {
    ...block.attributes,
    offset: 999,
    perPage: 1,
    order: "asc",
    items: [{ id: gamma }, { id: beta }, { id: gamma }],
  };
  expect(
    renderDesignQuery(block, {
      resolvePost: (item) => posts.get(item.id),
      render: (_blocks, post) => `[${post!.title}]`,
    }),
  ).toBe("[Gamma][Beta][Gamma]");
  block.attributes.items = [];
  expect(renderDesignQuery(block, { render })).toBe("");
});

test("diagnoses missing preloaded contexts rather than rendering an outer post or saved placeholder", () => {
  const outer = posts.get(beta)!;
  expect(() => renderDesignQuery(query, { post: outer, render })).toThrow(
    `preloaded post context for item ${beta}`,
  );
  expect(() =>
    renderDesignQuery(query, {
      render,
      resolvePost: (item) => (item.id === beta ? outer : undefined),
    }),
  ).toThrow(`preloaded post context for item ${gamma}`);
  for (const name of ["core/post-title", "core/post-content"]) {
    expect(() =>
      renderDesignPostBlock(
        { name, attributes: {}, content: "Wrong context", children: [] },
        { render },
      ),
    ).toThrow(`${name} requires preloaded post context`);
  }
  expect(() => renderDesignQuery({ ...query, attributes: {} }, { render })).toThrow(
    "producer-resolved items",
  );
  expect(() => renderDesignQuery({ ...query, attributes: { items: [{}] } }, { render })).toThrow(
    "item identity",
  );
});

test("delegates recursively to the caller so Site overrides still receive each post context", () => {
  const overridden = (blocks: DesignBlock[], post?: DesignPostContext): string => {
    const context: DesignQueryRenderContext = {
      post,
      resolvePost: (item) => posts.get(item.id),
      render: overridden,
    };
    return renderDesignPattern(blocks, {
      blocks: {
        "getquick-design/query": (block) => renderDesignQuery(block, context)!,
        "core/post-title": () => `<strong>${post!.title} custom title</strong>`,
        "core/post-content": (block) => renderDesignPostBlock(block, context)!,
        "core/block": (block) => renderDesignPostBlock(block, context)!,
        "core/paragraph": () => `<p>${post!.title} custom body</p>`,
      },
    });
  };
  const html = overridden([query]);
  expect(html).toContain("Beta custom title</strong>");
  expect(html).toContain("Gamma custom title</strong>");
  expect(html.match(/Beta custom body/g)).toHaveLength(2);
  expect(html.match(/Gamma custom body/g)).toHaveLength(2);
  expect(html).not.toContain("Beta content");
});

test("unrelated blocks return undefined so the caller continues its renderer chain", () => {
  const paragraph = posts.get(beta)!.blocks[0];
  expect(renderDesignQuery(paragraph, { render })).toBeUndefined();
  expect(renderDesignPostBlock(paragraph, { render })).toBeUndefined();
});

test("saved document and public tree agree on the actual authored Query and item pattern", () => {
  const saved = readFileSync(
    new URL("./fixtures/query-composition/saved.html", import.meta.url),
    "utf8",
  );
  const attributes = JSON.parse(saved.match(/<!-- wp:getquick-design\/query (\{.*\}) \/-->/)![1]);
  expect(attributes).toEqual({
    patternId: attributes.patternId,
    postType: "gqd81_item",
    perPage: 2,
    orderBy: "title",
    order: "asc",
    offset: 1,
  });
  expect(query.attributes).toMatchObject(attributes);
  const pattern = readFileSync(
    new URL("./fixtures/query-composition/item-pattern.html", import.meta.url),
    "utf8",
  );
  expect(pattern).toContain('wp:post-title {"level":2,"presentation":{"base":{"fontSize":"2xl"}}}');
  expect(query.children.map((block) => block.name)).toEqual([
    "core/post-title",
    "core/post-content",
    "core/block",
  ]);
});

test("URI preloading rejects a reused route belonging to a different selected identity", async () => {
  const { preloadDesignQueryPosts } = await import("@getquick/content");
  const selected = {
    name: "getquick-design/query",
    attributes: { items: [{ id: 12, type: "post", uri: "/reused/" }] },
    content: null,
    children: [],
  };
  await expect(
    preloadDesignQueryPosts([selected], async () => ({
      id: "global-id",
      databaseId: 99,
      title: "Different post",
      uri: "/reused/",
      designBlocks: [],
    })),
  ).rejects.toThrow("does not match its published post context");
});
