/// <reference types="node" />
import { expect, test } from "vite-plus/test";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import fixture from "./fixtures/image-source/public.json";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderDesignImage } from "@getquick/content";
import { presentationHtml } from "@getquick/content";

function elements(html: string): Array<Record<string, string>> {
  const found: Array<{ tagName: string; attrs: Array<{ name: string; value: string }> }> = [];
  function visit(node: DefaultTreeAdapterMap["node"]) {
    if ("tagName" in node) found.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  parseFragment(html).childNodes.forEach(visit);
  return found.map((node) => ({
    tag: node.tagName,
    ...Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])),
  }));
}

test("attrs-only public Image retains producer source and link identities independently of presentation", () => {
  const html = renderDesignImage(fixture.sourceNode.attributes);
  const [figure, link, image, caption] = elements(html);
  expect(figure.tag).toBe("figure");
  expect(figure.style).toContain("--gqd-base-height:calc(var(--gqd-spacing, 0.25rem) * 48)");
  expect(link).toMatchObject({
    tag: "a",
    href: "https://example.test/route",
    target: "_blank",
    rel: "noopener noreferrer",
  });
  expect(image).toMatchObject({
    tag: "img",
    src: "https://gqd-media.test/photo.svg",
    alt: "Mountain",
    title: "Mountain & valley",
    width: "800",
    height: "400",
    srcset: "https://gqd-media.test/small.svg 400w, https://gqd-media.test/photo.svg 1200w",
    sizes: "(max-width: 800px) 100vw, 800px",
  });
  expect(image.style).toBeUndefined();
  expect(caption).toMatchObject({ tag: "figcaption", class: "wp-element-caption" });
  expect(html).toContain(">Caption</figcaption>");
});

test("complete native saved HTML stays authoritative across direct and REST public nodes", () => {
  for (const node of [fixture.sourceNode, fixture.nodes[0], fixture.restNodes[0]]) {
    const shell = node.content!;
    const html = renderDesignImage(
      { ...node.attributes, url: "https://ignored.test/image", alt: "Ignored", caption: "Ignored" },
      shell,
    );
    expect(html).toBe(presentationHtml("core/image", shell, node.attributes.presentation));
  }
  const direct = '<img src="https://saved.test/image" alt="Saved" width="700">';
  const html = renderDesignImage(fixture.sourceNode.attributes, direct);
  expect(html).toBe(
    presentationHtml("core/image", direct, fixture.sourceNode.attributes.presentation),
  );
  expect(elements(html)[0]).toMatchObject({ tag: "img", width: "700", alt: "Saved" });
});

test("source fallback preserves safe rich captions and omits executable source data", () => {
  const html = renderDesignImage({
    url: "javascript:alert(1)",
    href: "java\nscript:alert(1)",
    alt: '" onerror="alert(1)',
    title: "<script>alert(1)</script>",
    srcSet: "https://safe.test/image 400w, javascript:alert(1) 2x, https://safe.test/large 800w",
    sizes: '" onload="alert(1)',
    width: -1,
    height: '400" onerror="alert(1)',
    caption:
      '<em>Mountain &amp; valley</em> <a href="/route" title="Read">Read</a><script>alert(1)</script><img src=x onerror=alert(1)><a href="jav&#x61;script:alert(1)" onclick="alert(1)">Unsafe</a><svg><a href="javascript:alert(1)">SVG</a></svg>',
  });
  const nodes = elements(html);
  const image = nodes.find((node) => node.tag === "img")!;
  expect(image).toMatchObject({
    alt: '" onerror="alert(1)',
    title: "<script>alert(1)</script>",
    srcset: "https://safe.test/image 400w, https://safe.test/large 800w",
    sizes: '" onload="alert(1)',
  });
  expect(image.src).toBeUndefined();
  expect(image.width).toBeUndefined();
  expect(image.height).toBeUndefined();
  expect(
    nodes.every(
      (node) =>
        !["script", "svg"].includes(node.tag) &&
        !Object.keys(node).some((name) => name.startsWith("on")),
    ),
  ).toBe(true);
  expect(nodes.filter((node) => node.tag === "img")).toHaveLength(1);
  expect(nodes.filter((node) => node.tag === "a")).toEqual([
    { tag: "a", href: "/route", title: "Read" },
    { tag: "a" },
  ]);
  expect(html).toContain("<em>Mountain &amp; valley</em>");
});

test("exact producer fixture provenance remains verifiable", () => {
  const bytes = readFileSync(new URL("./fixtures/image-source/public.json", import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "385b5b07f800c9189b7a2a52a98f88ea9d6a7addb0839ff5fd262c50a698f4ff",
  );
});

test("intrinsic dimensions do not invent neutral presentation and invalid media candidates are omitted", () => {
  const html = renderDesignImage(
    {
      url: "https://images.test/photo?one=1&two=2",
      width: 800,
      height: 400,
      srcSet:
        "data:image/svg+xml;base64,AAAA 1x, //evil.test/image 2x, https://safe.test/a nope, https://safe.test/b 0w, https://safe.test/c 1.5x",
      href: "/gallery",
      linkTarget: '" onclick="alert(1)',
      rel: '" onmouseover="alert(1)',
    },
    "  ",
  );
  const [figure, link, image] = elements(html);
  expect(figure.style).toBeUndefined();
  expect(link).toMatchObject({
    href: "/gallery",
    target: '" onclick="alert(1)',
    rel: '" onmouseover="alert(1)',
  });
  expect(link.onclick).toBeUndefined();
  expect(link.onmouseover).toBeUndefined();
  expect(image).toMatchObject({
    src: "https://images.test/photo?one=1&two=2",
    width: "800",
    height: "400",
    alt: "",
    srcset: "https://safe.test/c 1.5x",
  });
  expect(image.style).toBeUndefined();
});

test("Image presentation still fails through the canonical renderer", () => {
  expect(() =>
    renderDesignImage({
      url: "https://safe.test/image",
      presentation: { base: { width: "1px; color:red" } },
    }),
  ).toThrow();
});

test("Post Featured Image uses the caller's matching preloaded post media context", async () => {
  const { renderDesignPattern } = await import("@getquick/content");
  const node = {
    name: "core/post-featured-image",
    attributes: { isLink: true, presentation: { base: { height: 48 } } },
    content: null,
    children: [],
  };
  const html = renderDesignPattern([node], {
    post: {
      id: 2,
      title: "Post",
      uri: "/post/",
      blocks: [],
      featuredImage: { sourceUrl: "https://media.test/post.svg", altText: "Actual post media" },
    },
  });
  expect(html).toContain("wp-block-post-featured-image");
  expect(html).toContain('href="/post/"');
  expect(html).toContain('src="https://media.test/post.svg"');
  expect(html).toContain('alt="Actual post media"');
  expect(html).not.toContain("wp-block-image");
  expect(renderDesignPattern([node])).toBe("");
});
