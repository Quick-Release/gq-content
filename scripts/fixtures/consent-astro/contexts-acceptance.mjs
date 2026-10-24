import assert from "node:assert/strict";

export async function contextsAcceptance(browser, origin) {
  const page = await browser.newPage();
  await page.route("https://example.test/*.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30"></svg>',
    }),
  );
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/presentation-contexts`);
    for (const [name, height] of [
      ["coverDefault", 430],
      ["coverNative", 500],
      ["coverHeight", 192],
      ["coverAspect", 337.5],
    ]) {
      assert.equal(
        await page
          .locator(`[data-context=${name}] .wp-block-cover`)
          .evaluate((node) => node.getBoundingClientRect().height),
        height,
      );
    }
    const actualHero = page.locator("[data-context=actualHero] section");
    const actualColors = await actualHero.evaluate((node) => ({
      color: getComputedStyle(node).color,
      background: getComputedStyle(node).backgroundColor,
    }));
    assert.deepEqual(actualColors, { color: "rgb(255, 255, 255)", background: "rgb(0, 0, 0)" });
    assert.equal(await actualHero.locator('a[href="#destination"]').count(), 1);
    const video = page.locator("[data-context=selfHosted] video");
    assert.equal(await video.evaluate((node) => node.paused), true);
    assert.equal(await video.getAttribute("autoplay"), null);
    assert.equal(await video.evaluate((node) => node.getBoundingClientRect().height), 256);
    assert.equal(
      await page.locator("[data-context=selfHosted] a").getAttribute("href"),
      "#destination",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForFunction(
      () => !document.querySelector("[data-context=selfHosted] video").paused,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => document.querySelector("[data-context=selfHosted] video").paused,
    );
    const feature = page.locator("[data-context=featured] figure");
    await feature.locator("img").evaluate((node) => node.decode());
    assert.equal(await feature.evaluate((node) => node.getBoundingClientRect().height), 192);
    assert.equal(
      await feature.locator("img").evaluate((node) => node.getBoundingClientRect().height),
      192,
    );
    assert.equal(await feature.locator("a").getAttribute("href"), "/loaded-post/");
    assert.equal(await feature.locator("img").getAttribute("alt"), "Loaded post image");
    assert.equal(
      await page.locator("[data-context=primary] img").getAttribute("src"),
      "https://example.test/primary.svg",
    );
    assert.equal(
      await page.locator("[data-context=dark] img").getAttribute("src"),
      "https://example.test/dark.svg",
    );
    assert.equal(await page.locator("[data-context=title] img").count(), 0);
    assert.equal(await page.locator("[data-context=title] a").textContent(), "Loaded Site title");
    const menu = page.locator("[data-context=language] details");
    await menu.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await menu.locator('a[href="/ar/"]').isVisible(), true);
    assert.equal(await menu.locator('[dir="rtl"]').count(), 1);
    assert.equal(await menu.locator('img[alt="العربية"]').count(), 1, await menu.innerHTML());
    assert.equal(await menu.locator('a[href="/pt/"]').count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await menu.evaluate((node) => node.open), false);
    console.log(
      "PASS explicit loaded Site contexts (supporting variants): native self-hosted video play/pause/motion/256px, Featured Image 192px/link/alt, primary/dark/title Branding and conditional language dropdown/RTL/flags/keyboard",
    );
  } finally {
    await page.close();
  }
}
