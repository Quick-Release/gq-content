import assert from "node:assert/strict";

export async function carouselAcceptance(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
  await page.route("https://example.test/*.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="red"/></svg>',
    }),
  );
  page.on("pageerror", (error) => console.log("Carousel page error:", error.message));
  try {
    await page.clock.install();
    await page.goto(`${origin}/presentation?controls`);
    for (const path of ["pattern", "parsed"]) {
      const root = page.locator(`[data-path=${path}] [data-gqd-carousel]`);
      await root.waitFor({ state: "visible" });
      await root.locator(":scope[data-gqd-mounted]").waitFor();
      await root.getByRole("button", { name: "Go to slide 1", exact: true }).click();
      const navColors = await root.locator("nav").evaluate((node) => ({
        background: getComputedStyle(node).backgroundColor,
        indicator: getComputedStyle(node.querySelector("[data-gqd-go]")).color,
      }));
      assert.deepEqual(navColors, { background: "rgb(1, 2, 3)", indicator: "rgb(4, 5, 6)" });
      const slides = root.locator(":scope > .wp-block-getquick-design-slider");
      assert.equal(await slides.count(), 3);
      assert.equal(await root.locator("h2").count(), 1);
      assert.equal(await root.locator('a[href="/first-slide"]').count(), 1);
      assert.equal(await root.locator("img").count(), 3);
      assert.equal(await root.evaluate((node) => node.getBoundingClientRect().height), 150);
      assert.equal(
        await root
          .locator(":scope > figure > a > img")
          .evaluate((node) => node.getBoundingClientRect().height),
        150,
      );
      const foreground = root.locator('a[href="/first-slide"]');
      await foreground.focus();
      for (const key of ["ArrowRight", "Home", "End"]) {
        await page.keyboard.press(key);
        assert.equal(
          await slides.nth(0).isVisible(),
          true,
          "foreground shortcuts must not hide focus",
        );
        assert.equal(await foreground.evaluate((node) => node === document.activeElement), true);
      }
      await root.getByRole("button", { name: "Next slide", exact: true }).click();
      assert.equal(
        await slides.nth(1).isVisible(),
        true,
        JSON.stringify(
          await slides.evaluateAll((nodes) =>
            nodes.map((node) => ({
              hidden: node.hidden,
              display: getComputedStyle(node).display,
              height: node.getBoundingClientRect().height,
              active: node.getAttribute("aria-label"),
            })),
          ),
        ),
      );
      await root.getByRole("button", { name: "Go to slide 3" }).focus();
      await page.keyboard.press("Home");
      assert.equal(await slides.nth(0).isVisible(), true);
      await page.clock.fastForward(6000); // Focus pauses autoplay.
      assert.equal(await slides.nth(0).isVisible(), true);
    }
    await page
      .locator("[data-path=pattern]")
      .getByRole("button", { name: "Go to slide 1", exact: true })
      .click();
    await page.locator("#outside").click();
    await page.mouse.move(0, 0);
    await page.clock.fastForward(3100);
    assert.equal(
      await page
        .locator("[data-path=pattern] [data-gqd-slide]:not([hidden])")
        .getAttribute("aria-label"),
      "2 of 3",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.fastForward(6000);
    assert.equal(
      await page
        .locator("[data-path=pattern] [data-gqd-slide]:not([hidden])")
        .getAttribute("aria-label"),
      "2 of 3",
    );
    for (const width of [767, 768, 769, 1279, 1280, 1281]) {
      await page.setViewportSize({ width, height: 800 });
      const display = await page
        .locator("[data-gqd-carousel]")
        .first()
        .evaluate((node) => getComputedStyle(node).display);
      assert.equal(display, width >= 768 && width < 1280 ? "none" : "grid");
    }
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto(`${origin}/presentation`); // Exact saved fixture has navigation semantically hidden.
    assert.equal(await page.locator("[data-gqd-carousel] nav").count(), 0);
    console.log(
      "PASS real Gutenberg Carousel snapshot: production Astro pattern/parsed rendering, linked media/order, controls, keyboard, focus pause, reduced motion and display restoration",
    );
  } finally {
    await page.close();
  }
}
