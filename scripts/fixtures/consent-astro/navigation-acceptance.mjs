import assert from "node:assert/strict";

export async function navigationAcceptance(browser, origin) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/presentation-navigation`);
    for (const dir of ["ltr", "rtl"]) {
      await page.locator("body").evaluate((node, direction) => (node.dir = direction), dir);
      for (const width of [959, 960, 961]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForFunction(() =>
          [...document.querySelectorAll("[data-gqd-navigation]")].every(
            (node) => node.hasAttribute("data-gqd-overlay-active") === innerWidth < 960,
          ),
        );
        for (const nav of await page.locator("[data-gqd-navigation]").all()) {
          const open = nav.locator(":scope > [data-gqd-navigation-open]");
          const panel = nav.locator("[data-gqd-navigation-panel]");
          const mobile = width < 960;
          assert.equal(await open.isVisible(), mobile);
          if (mobile) {
            assert.equal(await panel.isVisible(), false);
            await open.click();
            assert.equal(await panel.isVisible(), true);
            assert.equal(await panel.getAttribute("aria-modal"), "true");
            await page.keyboard.press("Escape");
            assert.equal(await panel.isVisible(), false);
            assert.equal(await open.evaluate((node) => node === document.activeElement), true);
          } else {
            assert.equal(await panel.isVisible(), true);
            assert.ok((await panel.locator("a[href]").count()) > 0);
          }
        }
      }
    }
    console.log(
      "PASS canonical Navigation fixtures through production Astro public runtime: native/custom links, 60rem override boundary, RTL, overlay focus/Escape",
    );
  } finally {
    await page.close();
  }
}
