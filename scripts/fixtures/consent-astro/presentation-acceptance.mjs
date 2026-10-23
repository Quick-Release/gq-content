import assert from "node:assert/strict";
import {
  presentationHtml,
  presentationStyleSheet,
  renderDesignPattern,
  renderWordPressBlocks,
} from "@getquick/content";

// The installed package, saved shell, and the same production CSS used by a Site.
export async function presentationAcceptance(browser) {
  const page = await browser.newPage();
  const name = "getquick-design/container";
  const presentation = {
    base: { width: "1/2", maxWidth: "none", paddingInline: 4, marginInline: "auto" },
    md: { width: "full", paddingInline: "reset" },
    xl: { width: "1/3" },
  };
  const shell = '<section id="authored"><a href="/brand">Brand</a></section>';
  const css = presentationStyleSheet(); // Compiled before the saved document is authored.
  const leaf = { name, attributes: { presentation }, content: shell, children: [] };
  try {
    for (const html of [
      presentationHtml(name, shell, presentation),
      renderDesignPattern([leaf]),
      renderWordPressBlocks([{ name, attributes: leaf.attributes, htmlContent: shell }]),
    ]) {
      for (const direction of ["ltr", "rtl"]) {
        await page.setContent(
          `<style>body{margin:0}main{width:360px;margin:20px}${css}</style><main dir="${direction}">${html}</main>`,
        );
        for (const boundary of [640, 768, 1024, 1280, 1536]) {
          for (const width of [boundary - 1, boundary, boundary + 1]) {
            await page.setViewportSize({ width, height: 800 });
            const layout = await page.locator("#authored").evaluate((node) => {
              const rect = node.getBoundingClientRect();
              const parent = node.parentElement.getBoundingClientRect();
              const style = getComputedStyle(node);
              return {
                width: rect.width,
                offset: rect.x - parent.x,
                padding: style.paddingInlineStart,
                href: node.querySelector("a").getAttribute("href"),
              };
            });
            const expected = width < 768 ? 180 : width < 1280 ? 360 : 120;
            assert.ok(Math.abs(layout.width - expected) < 0.1);
            assert.ok(Math.abs(layout.offset - (360 - expected) / 2) < 0.1);
            assert.equal(layout.padding, width < 768 ? "16px" : "0px");
            assert.equal(layout.href, "/brand");
          }
        }
      }
    }
    // Class-only delivered HTML gets exact bare Container caps, without centering.
    for (const [width, cap] of [
      [639, 639],
      [640, 640],
      [767, 640],
      [768, 768],
      [1024, 1024],
      [1280, 1280],
      [1536, 1536],
    ]) {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(
        `<style>body{margin:0}${css}</style><div class="wp-block-getquick-design-container gqd-presentation">Saved content</div>`,
      );
      const layout = await page.locator("div").evaluate((node) => ({
        width: node.getBoundingClientRect().width,
        margin: getComputedStyle(node).marginInline,
        padding: getComputedStyle(node).paddingInline,
      }));
      assert.equal(layout.width, cap);
      assert.equal(layout.margin, "0px");
      assert.equal(layout.padding, "0px");
    }
    console.log(
      "PASS presentation: installed HTML/chrome/parsed content, all breakpoint boundaries, RTL, narrow parent, reset, late authorship and bare defaults",
    );
  } finally {
    await page.close();
  }
}
