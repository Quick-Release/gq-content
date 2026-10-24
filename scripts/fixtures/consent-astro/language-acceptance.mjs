import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export async function languageAcceptance(browser, origin) {
  const page = await browser.newPage();
  const directory = new URL("./src/fixtures/navigation/language-flags/", import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL("provenance.json", directory), "utf8"));
  for (const [url, asset] of Object.entries(provenance.flagAssets)) {
    await page.route(url, (route) =>
      route.fulfill({
        status: asset.status,
        contentType: asset.contentType,
        body: readFileSync(new URL(asset.file, directory)),
      }),
    );
  }
  try {
    for (const flags of [false, true]) {
      await page.goto(`${origin}/presentation-language${flags ? "?flags" : ""}`);
      for (const lang of ["en", "fr"]) {
        const nodes = JSON.parse(
          readFileSync(
            new URL(
              `./src/fixtures/navigation/${flags ? "language-flags" : "language"}/${lang}-nodes.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
        const region = page.locator(`[data-language-source=${lang}]`);
        assert.equal(await region.locator(":scope > *").count(), 3);
        if (!flags) assert.equal(await region.locator("img").count(), 0);
        for (let index = 0; index < nodes.length; index++) {
          const node = nodes[index];
          const root = region.locator(":scope > *").nth(index);
          if (node.attributes.dropdown) {
            await root.locator("summary").focus();
            await page.keyboard.press("Enter");
          }
          for (const link of node.attributes.links) {
            const anchor = root.locator(`a[href="${link.url}"]`);
            assert.equal(await anchor.isVisible(), true);
            assert.equal(await anchor.getAttribute("aria-label"), link.label);
            assert.equal(await anchor.getAttribute("aria-current"), link.current ? "page" : null);
            if (link.flagUrl && node.attributes.show_flags) {
              const img = anchor.locator("img");
              assert.equal(await img.getAttribute("src"), link.flagUrl);
              await img.evaluate((image) => image.decode());
              assert.ok(
                await img.evaluate(
                  (image) => image.naturalWidth > 0 && image.getBoundingClientRect().width > 0,
                ),
              );
              if (node.attributes.show_names === false)
                assert.equal(await img.getAttribute("alt"), link.label);
            }
            if (node.attributes.show_names !== false || !link.flagUrl)
              assert.ok((await anchor.textContent()).includes(link.label));
          }
          if (node.attributes.dropdown) {
            await page.keyboard.press("Escape");
            assert.equal(await root.evaluate((element) => element.open), false);
            assert.equal(
              await root
                .locator("summary")
                .evaluate((element) => element === document.activeElement),
              true,
            );
          }
        }
      }
    }
    // Raw WP HTML keeps its own captured select/change controller. This proves
    // initial SSR behavior only, independently from the neutral details adapter.
    for (const lang of ["en", "fr"]) {
      const nodes = JSON.parse(
        readFileSync(
          new URL(`./src/fixtures/navigation/language-flags/${lang}-nodes.json`, import.meta.url),
          "utf8",
        ),
      );
      const target = nodes[2].attributes.links.find((link) => !link.current);
      await page.route(target.url, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<html><body>Captured home destination</body></html>",
        }),
      );
      await page.goto(`${origin}/presentation-language?body&flags&lang=${lang}`);
      const select = page.getByRole("combobox");
      assert.equal(await select.count(), 1);
      await Promise.all([page.waitForURL(target.url), select.selectOption(target.url)]);
      assert.equal(page.url(), target.url);
    }
    for (const lang of ["en", "fr"]) {
      const nodes = JSON.parse(
        readFileSync(
          new URL(`./src/fixtures/navigation/language-flags/${lang}-nodes.json`, import.meta.url),
          "utf8",
        ),
      );
      const target = nodes[2].attributes.links.find((link) => !link.current);
      await page.goto(`${origin}/presentation-language?body&flags&delivery&lang=${lang}`);
      const select = page.getByRole("combobox");
      assert.equal(
        await select.locator("..").locator("script").count(),
        0,
        "publication delivery strips the captured inline controller",
      );
      const originalUrl = page.url();
      await select.evaluate((element) => {
        for (const value of [
          "javascript:window.gqdUnsafeLanguage=true",
          "https://user:pass@example.test/",
          "https://example.test/\\evil",
        ]) {
          const option = document.createElement("option");
          option.value = value;
          option.text = "Unsafe supporting option";
          element.append(option);
          element.value = value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          option.remove();
        }
      });
      assert.equal(page.url(), originalUrl);
      assert.equal(await page.evaluate(() => window.gqdUnsafeLanguage), undefined);
      await page.evaluate(() => window.dispatchEvent(new Event("gqd:test-navigation-cleanup")));
      await select.selectOption(target.url);
      assert.equal(page.url(), originalUrl, "cleanup removes the native dropdown handler");
      await page.evaluate(() => window.dispatchEvent(new Event("gqd:test-navigation-remount")));
      await Promise.all([
        page.waitForURL(target.url, { timeout: 3000 }),
        select.selectOption(target.url),
      ]);
      assert.equal(
        page.url(),
        target.url,
        "shared native controller must survive scriptless delivery",
      );
      await page.goto(`${origin}/presentation-language?body&flags&delivery&lang=${lang}`);
      const keyboardSelect = page.getByRole("combobox");
      await keyboardSelect.focus();
      await Promise.all([
        page.waitForURL(target.url, { timeout: 3000 }),
        page.keyboard.press(
          nodes[2].attributes.links.findIndex((link) => link.url === target.url) === 0
            ? "Home"
            : "End",
        ),
      ]);
      assert.equal(
        page.url(),
        target.url,
        "native keyboard selection uses the delivered destination",
      );
    }
    for (const lang of ["en", "fr"]) {
      await page.goto(`${origin}/presentation-language?body&a11y&lang=${lang}`);
      const flagsOnly = page.locator(".gqd-capture-language-flags");
      assert.equal(await flagsOnly.getByRole("link", { name: "English", exact: true }).count(), 1);
      assert.equal(await flagsOnly.getByRole("link", { name: "Français", exact: true }).count(), 1);
    }
    console.log(
      "PASS actual Polylang FREE EN/FR null/flag captures: eligible home URLs, names/flags-only accessible fallback, exact PNG decoding, current metadata, dropdown retains current, keyboard; no DTO URL rewrite",
    );
  } finally {
    await page.close();
  }
}
