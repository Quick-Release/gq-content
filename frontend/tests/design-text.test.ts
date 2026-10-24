import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
/// <reference types="node" />
import { expect, test } from "vite-plus/test";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import fixture from "./fixtures/typography/public.json";
import { renderDesignPattern, type DesignBlock } from "@getquick/content";
import { renderDesignText } from "@getquick/content";

function elements(html: string) {
  const result: Array<{ tag: string; attrs: Record<string, string>; text: string }> = [];
  function text(node: DefaultTreeAdapterMap["node"]): string {
    return "value" in node
      ? node.value
      : "childNodes" in node
        ? node.childNodes.map(text).join("")
        : "";
  }
  function visit(node: DefaultTreeAdapterMap["node"]) {
    if ("tagName" in node)
      result.push({
        tag: node.tagName,
        attrs: Object.fromEntries(node.attrs.map(({ name, value }) => [name, value])),
        text: text(node),
      });
    if ("childNodes" in node) node.childNodes.forEach(visit);
  }
  visit(parseFragment(html));
  return result;
}

function render(nodes: DesignBlock[]): string {
  return renderDesignPattern(nodes);
}

test.each(fixture.cases)(
  "$name actual saved/reopened neutral text retains native list structure and button content",
  (entry) => {
    const html = render(entry.neutralNodes);
    const nodes = elements(html);
    expect(nodes.map((node) => node.tag)).toEqual([
      "h3",
      "p",
      "ol",
      "li",
      "ul",
      "li",
      "div",
      "div",
      "a",
      "strong",
      "ul",
      "li",
    ]);
    expect(nodes[0].text).toBe("Authored heading");
    expect(nodes[1].text).toBe("Default paragraph");
    expect(nodes[2].attrs).toMatchObject({ start: "3", reversed: "" });
    expect(nodes[3].text).toBe("Parent itemNested item");
    expect(nodes[5].text).toBe("Nested item");
    expect(nodes[8].attrs).toMatchObject({
      href: "/shop",
      target: "_blank",
      rel: "noopener",
      title: "Spend > save",
    });
    expect(nodes[8].text).toBe("Go shopping");
    // WordPress serializes these attributes even on its unordered list.
    expect(nodes[10].attrs).toMatchObject({ start: "3", reversed: "" });
    expect(nodes[11].text).toBe("Unordered item");
    expect(nodes[0].attrs.style).toContain("--gqd-md-fontSize:var(--gqd-text-2xl");
    expect(nodes[6].attrs.style).toContain("--gqd-lg-flexDirection:row");
  },
);

test("source text retains safe inline HTML and heading structure independently of its font", () => {
  const html = renderDesignText("core/heading", {
    level: 5,
    content: 'Read <em>this</em> &amp; <a href="/guide" title="Guide">learn</a>',
    presentation: { base: { fontSize: "xl" } },
  })!;
  expect(elements(html).map((node) => node.tag)).toEqual(["h5", "em", "a"]);
  expect(elements(html)[0].text).toBe("Read this & learn");
  expect(
    renderDesignText("core/paragraph", { content: "<strong>Text</strong><br>second" }),
  ).toContain("<strong>Text</strong><br>second");
  expect(
    renderDesignText("core/list-item", { content: "<em>Parent</em>" }, "<ul><li>Child</li></ul>"),
  ).toContain("<em>Parent</em><ul><li>Child</li></ul></li>");
});

test("source Buttons preserve actual native attributes and reject executable rich text", () => {
  const html = renderDesignText("core/button", {
    text: 'Go <strong>shopping</strong><script>bad()</script><svg onload="bad()"><a>bad</a></svg><img src=x onerror="bad()"><a href="jav&#x61;script:bad()" onclick="bad()">unsafe</a>',
    url: "java\nscript:bad()",
    linkTarget: "_blank",
    rel: "noopener",
    title: "Spend > save",
  })!;
  const nodes = elements(html);
  expect(nodes.map((node) => node.tag)).toEqual(["div", "a", "strong", "a"]);
  expect(nodes[1].attrs).toMatchObject({
    target: "_blank",
    rel: "noopener",
    title: "Spend > save",
  });
  expect(nodes[1].attrs.href).toBeUndefined();
  expect(nodes[3].attrs.href).toBeUndefined();
  expect(html).not.toContain("bad()");
  const button = elements(
    renderDesignText("core/button", {
      tagName: "button",
      type: "submit",
      text: "Send",
      url: "/ignored",
      title: '" onclick="bad()',
    })!,
  )[1];
  expect(button).toMatchObject({
    tag: "button",
    attrs: { type: "submit", title: '" onclick="bad()' },
    text: "Send",
  });
  expect(button.attrs.href).toBeUndefined();
  expect(button.attrs.onclick).toBeUndefined();
});

test.each(fixture.cases)(
  "$name source-only Button matches actual saved text and link identity",
  (entry) => {
    const buttons = entry.neutralNodes.find((node) => node.name === "core/buttons")!;
    const button = buttons.children[0];
    const source = elements(renderDesignText(button.name, button.attributes)!);
    const saved = elements(button.content!);
    expect(source.slice(1)).toEqual(saved.slice(1));
  },
);

test("dynamic text uses supplied site context, never invented values", () => {
  for (const entry of fixture.cases) {
    expect(
      elements(
        renderDesignText("core/site-title", { level: 1 }, "", { site: entry.context.site })!,
      )[0],
    ).toMatchObject({ tag: "h1", text: "GQ Design tests" });
    expect(
      elements(renderDesignText("core/site-tagline", {}, "", { site: entry.context.site })!)[0],
    ).toMatchObject({ tag: "p", text: "Typography Site Tagline" });
  }
  expect(renderDesignText("core/site-title", {})).toBeUndefined();
  expect(renderDesignText("core/site-tagline", {})).toBeUndefined();
  expect(renderDesignText("core/post-content", {})).toBeUndefined();
  expect(renderDesignText("core/post-title", {})).toBeUndefined();
});

test("Date and Excerpt require explicitly supplied post values without a query or date formatter", () => {
  const context = {
    post: {
      uri: "/news",
      date: { text: "24 October 2026", dateTime: "2026-10-24T09:00:00+01:00" },
      excerpt: "A <em>real</em> excerpt &amp; more",
    },
  };
  const date = elements(renderDesignText("core/post-date", { isLink: true }, "", context)!);
  expect(date.map((node) => node.tag)).toEqual(["div", "a", "time"]);
  expect(date[1].attrs.href).toBe("/news");
  expect(date[2]).toMatchObject({
    attrs: { datetime: "2026-10-24T09:00:00+01:00" },
    text: "24 October 2026",
  });
  const excerpt = elements(renderDesignText("core/post-excerpt", {}, "", context)!);
  expect(excerpt.map((node) => node.tag)).toEqual(["div", "p", "em"]);
  expect(excerpt[0].text).toBe("A real excerpt & more");
  expect(renderDesignText("core/post-date", {})).toBeUndefined();
  expect(renderDesignText("core/post-excerpt", {})).toBeUndefined();
  expect(
    renderDesignText("core/post-date", { isLink: true }, "", { post: { date: context.post.date } }),
  ).toBeUndefined();
});

test("unsupported or missing text sources are explicit and root Lists never invent text", () => {
  expect(renderDesignText("core/paragraph", {})).toBeUndefined();
  expect(renderDesignText("core/heading", {})).toBeUndefined();
  expect(renderDesignText("core/list-item", {})).toBeUndefined();
  expect(renderDesignText("core/button", {})).toBeUndefined();
  expect(renderDesignText("site/custom-text", { content: "Unknown" })).toBeUndefined();
  expect(
    renderDesignText(
      "core/list",
      { content: "Never a list source", ordered: true, start: -2, reversed: true },
      "<li>Actual item</li>",
    ),
  ).not.toContain("Never a list source");
  const list = elements(
    renderDesignText(
      "core/list",
      { ordered: true, start: -2, reversed: true },
      "<li>Actual item</li>",
    )!,
  );
  expect(list[0]).toMatchObject({
    tag: "ol",
    attrs: { start: "-2", reversed: "" },
    text: "Actual item",
  });
  expect(elements(renderDesignText("core/list", { start: 2.5 })!)[0].attrs.start).toBeUndefined();
});

test("Site context is plain text and absent link context remains unrendered", () => {
  const site = { title: "<script>Title</script> & name", description: "<em>Tagline</em>" };
  expect(renderDesignText("core/site-title", {}, "", { site })).toBeUndefined();
  const title = elements(
    renderDesignText("core/site-title", { level: 0, isLink: false }, "", { site })!,
  );
  expect(title).toHaveLength(1);
  expect(title[0]).toMatchObject({ tag: "p", text: "<script>Title</script> & name" });
  expect(elements(renderDesignText("core/site-tagline", {}, "", { site })!)[0].text).toBe(
    "<em>Tagline</em>",
  );
});

test("all styling still fails through the shared presentation boundary", () => {
  expect(() =>
    renderDesignText("core/paragraph", {
      content: "Text",
      presentation: { base: { fontSize: "xl; color:red" } },
    }),
  ).toThrow();
});

test("producer fixture bytes and their explicit layout acceptance limitation remain intact", () => {
  const bytes = readFileSync(new URL("./fixtures/typography/public.json", import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "55916b46bbfed0bb4ee64bd89a0ff9c39ab5f4e8fe8039db0099dc3a94a32d77",
  );
  for (const entry of fixture.cases) {
    expect(entry.layout).toMatchObject({
      available: false,
      error: { status: 422, code: "getquick_design_invalid_template_structure" },
    });
  }
});

test("refreshed producer inline DTO renders Heading/Paragraph without a saved wrapper parser", async () => {
  const inline = JSON.parse(
    readFileSync(new URL("./fixtures/typography/inline-public.json", import.meta.url), "utf8"),
  );
  for (const entry of inline.cases) {
    // Supporting attrs-only adapter variant of untouched source DTOs.
    const nodes = entry.neutralNodes
      .slice(0, 2)
      .map((node: DesignBlock) => ({ ...node, content: null }));
    const html = renderDesignPattern(nodes);
    expect(html).toContain("<strong>head</strong>");
    expect(html).toContain('<span class="inline-label">ing</span>');
    expect(html).toContain('title="Read &gt; learn" href="/guide"');
    expect(html).toContain("<strong>para</strong>");
    expect(html).toContain('<span class="inline-label">graph</span>');
  }
});
