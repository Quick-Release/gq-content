// Run against the installed retained package in Chromium, with no Site CSS.
import assert from "node:assert/strict";
import { designGridStyle, renderDesignPattern, renderWordPressBlocks } from "@getquick/content";

export async function gridAcceptance(browser) {
  const page = await browser.newPage();
  try {
    const children = ["logo", "navigation"].map((label) => ({
      name: "getquick-design/container",
      attributes: {},
      content: null,
      children: [{ name: `getquick/${label}`, attributes: {}, content: null, children: [] }],
    }));
    const options = {
      blocks: {
        "getquick/logo": () => "<span>Logo</span>",
        "getquick/navigation": () => "<nav>Navigation</nav>",
      },
    };
    for (const columns of [1, 2, 3, 4, 5, 6, undefined, '3" onload="x']) {
      const attributes = { columns, tabletColumns: columns, mobileColumns: columns };
      const pattern = renderDesignPattern(
        [
          {
            name: "getquick-design/grid",
            attributes,
            content: null,
            children,
          },
        ],
        options,
      );
      const expected = (fallback) => (Number.isInteger(columns) ? columns : fallback);
      const content = renderWordPressBlocks([
        {
          name: "getquick-design/grid",
          attributes,
          htmlContent: `<div class="wp-block-getquick-design-grid gqd-grid--${expected(3)} gqd-grid--tablet-${expected(2)} gqd-grid--mobile-${expected(1)}"></div>`,
          innerBlocks: children.map((child) => ({
            name: "core/html",
            htmlContent: renderDesignPattern([child], options),
          })),
        },
      ]);
      assert.equal(pattern, content);
      await page.setContent(`<style>${designGridStyle()}</style>${pattern}`);
      for (const width of [375, 767, 768, 1023, 1024, 1920]) {
        await page.setViewportSize({ width, height: 800 });
        const layout = await page.locator(".wp-block-getquick-design-grid").evaluate((grid) => {
          const css = getComputedStyle(grid);
          return {
            display: css.display,
            tracks: css.gridTemplateColumns.split(" ").length,
            gap: css.gap,
            items: [...grid.children].map((child) => ({
              y: child.getBoundingClientRect().y,
              minWidth: getComputedStyle(child).minWidth,
              margin: getComputedStyle(child).marginBlock,
            })),
          };
        });
        const count = expected(width < 768 ? 1 : width < 1024 ? 2 : 3);
        assert.equal(layout.display, "grid");
        assert.equal(layout.tracks, count);
        assert.equal(layout.gap, "16px");
        assert.equal(layout.items[0].minWidth, "0px");
        assert.equal(layout.items[0].margin, "0px");
        assert.equal(layout.items[0].y === layout.items[1].y, count > 1);
      }
    }
    console.log(
      "PASS Grid chrome/content parity: 1–6 columns, defaults, unsafe input, 375/767/768/1023/1024/1920px",
    );
  } finally {
    await page.close();
  }
}
