// Actual Gutenberg/sidebar->REST snapshots, rendered by the installed production package.
import assert from "node:assert/strict";
export async function gridAcceptance(browser, origin) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/presentation-layout`);
    for (const width of [
      639, 640, 641, 767, 768, 769, 1023, 1024, 1025, 1279, 1280, 1281, 1535, 1536, 1537,
    ]) {
      await page.setViewportSize({ width, height: 800 });
      for (const direction of ["ltr", "rtl"]) {
        await page.locator("body").evaluate((node, dir) => (node.dir = dir), direction);
        for (const path of ["pattern", "html"]) {
          const result = await page.locator(`[data-path=${path}]`).evaluate((root) => {
            const grid = root.querySelector(".wp-block-getquick-design-grid");
            const group = root.querySelector(".wp-block-group");
            const columns = root.querySelector(".wp-block-columns");
            const items = [...columns.children];
            const spacer = root.querySelector(".wp-block-spacer");
            const separator = root.querySelector(".wp-block-separator");
            const narrow = root.querySelector("#narrow-grid");
            const narrowBox = narrow.getBoundingClientRect();
            const parentBox = root.querySelector("#narrow-parent").getBoundingClientRect();
            return {
              display: getComputedStyle(grid).display,
              tracks: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
              gap: getComputedStyle(grid).columnGap,
              rowGap: getComputedStyle(grid).rowGap,
              groupDisplay: getComputedStyle(group).display,
              narrowColumns: getComputedStyle(narrow).gridTemplateColumns.split(" ").length,
              narrowRowGap: getComputedStyle(narrow).rowGap,
              narrowColumnGap: getComputedStyle(narrow).columnGap,
              narrowFits: narrowBox.left >= parentBox.left && narrowBox.right <= parentBox.right,
              groupGap: getComputedStyle(group).gap,
              direction: getComputedStyle(group).flexDirection,
              columnDisplay: getComputedStyle(columns).display,
              ratio:
                items[1].getBoundingClientRect().width / items[0].getBoundingClientRect().width,
              align: getComputedStyle(items[1]).alignSelf,
              spacer: spacer.getBoundingClientRect().height,
              opacity: getComputedStyle(separator).opacity,
            };
          });
          assert.equal(result.display, "grid");
          assert.equal(result.tracks, width < 768 ? 3 : width < 1280 ? 4 : width < 1536 ? 1 : 3);
          assert.equal(result.gap, "16px");
          assert.equal(result.rowGap, width < 768 ? "16px" : "0px");
          assert.equal(result.groupDisplay, "flex");
          assert.equal(result.narrowColumns, 2);
          assert.equal(result.narrowRowGap, width < 768 ? "0px" : width < 1280 ? "16px" : "0px");
          assert.equal(result.narrowColumnGap, width < 768 ? "8px" : width < 1280 ? "16px" : "0px");
          assert.equal(result.narrowFits, true);
          assert.equal(result.groupGap, "24px");
          assert.equal(result.direction, width < 1024 ? "row" : "column");
          assert.equal(result.columnDisplay, "flex");
          assert.ok(
            Math.abs(result.ratio - 3) < 0.05,
            `${path}: unequal Columns ratio ${result.ratio}`,
          );
          assert.equal(result.align, width < 1024 ? "center" : "end");
          assert.equal(result.spacer, width < 768 ? 37 : width < 1280 ? 32 : 0);
          assert.equal(result.opacity, "0.5");
        }
      }
    }
    console.log(
      "PASS real saved layout: production Astro public pattern/WP HTML, 15 breakpoint boundaries, RTL, narrow parent, Grid tracks/gaps, Group flex, native 25/75 Columns, Spacer and Separator",
    );
  } finally {
    await page.close();
  }
}
