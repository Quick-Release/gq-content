import assert from "node:assert/strict";

export async function nativeColumnsAcceptance(browser, origin) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/presentation-native-columns`);
    for (const dir of ["ltr", "rtl"]) {
      await page.locator("body").evaluate((node, direction) => (node.dir = direction), dir);
      for (const width of [640, 781, 782, 783, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of ["pattern", "html"]) {
          const rows = await page
            .locator(`[data-path=${path}] > .wp-block-columns`)
            .evaluateAll((nodes) =>
              nodes.map((node) => ({
                width: node.getBoundingClientRect().width,
                align: getComputedStyle(node).alignItems,
                items: [...node.children]
                  .filter((child) => child.classList.contains("wp-block-column"))
                  .map((child) => ({
                    width: child.getBoundingClientRect().width,
                    top: child.getBoundingClientRect().top,
                    align: getComputedStyle(child).alignSelf,
                  })),
              })),
            );
          assert.equal(rows.length, 4);
          const equal = rows[0];
          assert.equal(equal.align, "center");
          if (width < 782) {
            assert.ok(Math.abs(equal.items[0].width - equal.width) < 1);
            assert.ok(equal.items[1].top > equal.items[0].top);
          } else assert.ok(Math.abs(equal.items[0].width - equal.width / 2) < 1);
          assert.equal(equal.items[1].align, "flex-end");
          assert.ok(Math.abs(rows[1].items[1].width / rows[1].items[0].width - 3) < 0.05);
          for (const column of rows[2].items)
            assert.ok(Math.abs(column.width - rows[2].width / 3) < 1);
          assert.equal(rows[3].align, "center");
          assert.equal(rows[3].items[0].align, "center");
          assert.ok(Math.abs(rows[3].items[0].width - rows[3].width / 4) < 1);
        }
      }
    }
    console.log(
      "PASS actual saved native Columns without WP core CSS: 781/782/783 boundary, equal growth, 25/75 nonstacking, native alignment, neutral overrides and RTL",
    );
  } finally {
    await page.close();
  }
}
