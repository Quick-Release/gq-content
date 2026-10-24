import { expect, test } from "vite-plus/test";
import {
  presentationHtml,
  presentationVariables,
  renderDesignPattern,
  renderWordPressBlocks,
} from "@getquick/content";
import { parseFragment } from "parse5";

test("saved shells and both public render paths deliver authored Container presentation", () => {
  const name = "getquick-design/container";
  const presentation = {
    base: { width: "1/2", marginInline: "auto", paddingInline: 4 },
    md: { width: "full" },
  };
  const saved =
    "<section id='brand' class='alignwide' aria-label='Brand > home'><a href='/'>Brand</a></section>";
  const html = presentationHtml(name, saved, presentation);
  const root = parseFragment(html).childNodes[0];
  expect(root).toHaveProperty("tagName", "section");
  if (!("attrs" in root)) throw new Error("Missing shell");
  const attrs = Object.fromEntries(root.attrs.map(({ name, value }) => [name, value]));
  expect(attrs.id).toBe("brand");
  expect(attrs["aria-label"]).toBe("Brand > home");
  expect(attrs.class.split(" ")).toEqual(
    expect.arrayContaining(["alignwide", "wp-block-getquick-design-container", "gqd-presentation"]),
  );
  expect(attrs.style).toContain("--gqd-base-width:50.00000000%");
  expect(html).toContain("<a href='/'>Brand</a>");
  expect(presentationVariables(name, presentation)["--gqd-md-width"]).toBe("100%");
  expect(
    renderDesignPattern([{ name, attributes: { presentation }, content: saved, children: [] }]),
  ).toBe(html);
  expect(renderWordPressBlocks([{ name, attributes: { presentation }, htmlContent: saved }])).toBe(
    html,
  );
});

test("saved HTML presentation rejects invalid values and keeps unsupported semantic content", () => {
  expect(() =>
    presentationHtml("getquick-design/container", "<div></div>", {
      base: { width: "1px; color:red" },
    }),
  ).toThrow();
  expect(presentationHtml("vendor/unknown", '<p class="brand">Copy</p>')).toBe(
    '<p class="brand">Copy</p>',
  );
  const html = presentationHtml(
    "getquick-design/container",
    '<!--lead--><div style="color:red;--gqd-base-width:100%" class="brand gqd-presentation"></div>',
    { base: { width: "1/2" } },
  );
  expect(presentationHtml("getquick-design/container", html, { base: { width: "1/2" } })).toBe(
    html,
  );
  const root = parseFragment(html).childNodes[1];
  if (!("attrs" in root)) throw new Error("Missing shell");
  const style = root.attrs.find(({ name }) => name === "style")?.value;
  expect(style).toBe("color:red;--gqd-base-width:50.00000000%");
});

test("ordinary delivered HTML retains authored variables when parsed attributes are absent", () => {
  const saved =
    '<div class="wp-block-getquick-design-container gqd-presentation" style="--gqd-base-width:50.00000000%"><p>Saved</p></div>';
  expect(
    renderWordPressBlocks([{ name: "getquick-design/container", htmlContent: saved }]),
  ).toContain("--gqd-base-width:50.00000000%");
});

test("actual public Cover with null content retains background, overlay and foreground", async () => {
  const { readFileSync } = await import("node:fs");
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/presentation/media-public.json", import.meta.url), "utf8"),
  );
  const cover = fixture.nodes.find((node: { name: string }) => node.name === "core/cover");
  const html = renderDesignPattern([cover]);
  expect(html).toContain('class="wp-block-cover__image-background');
  expect(html).toContain('src="https://gqd-media.test/photo.svg"');
  expect(html).toContain("wp-block-cover__background");
  expect(html).toContain("wp-block-cover__inner-container");
  expect(html).toContain("Readable foreground");
});

test("actual native Columns preserve unequal sizing and non-stacking without neutral overrides", async () => {
  const { readFileSync } = await import("node:fs");
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/presentation/layout.json", import.meta.url), "utf8"),
  );
  const columns = fixture.nodes.find((node: { name: string }) => node.name === "core/columns");
  const html = renderDesignPattern([columns]);
  expect(html).toContain("is-not-stacked-on-mobile");
  expect(html).toContain("flex-basis:25%");
  expect(html).toContain("flex-basis:75%");
});

test("reapplying wrapper helpers replaces generated context variables without duplication", () => {
  const name = "getquick-design/slider";
  const once = presentationHtml(name, '<figure style="--gqd-base-height:150px"></figure>');
  expect(presentationHtml(name, once)).toBe(once);
});

test("native Group layout context is forwarded and remains idempotent", () => {
  const attributes = { layout: { type: "flex", orientation: "vertical" } };
  const once = presentationHtml(
    "core/group",
    '<div style="--gqd-base-gap:2rem"></div>',
    undefined,
    { attributes },
  );
  expect(once).toContain("--gqd-display:flex");
  expect(presentationHtml("core/group", once, undefined, { attributes })).toBe(once);
});
