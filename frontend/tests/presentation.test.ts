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
  expect(presentationHtml("core/paragraph", '<p class="brand">Copy</p>')).toBe(
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
