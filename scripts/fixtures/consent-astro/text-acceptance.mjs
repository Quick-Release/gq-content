import assert from "node:assert/strict";

// Exact b11b763 public tree versus its real WordPress renderedHTML. The captured
// preview layout was rejected (422); this proves the content adapter, not that API.
export async function textAcceptance(browser, origin) {
  const page = await browser.newPage();
  try {
    for (const query of ["", "?override"]) {
      await page.goto(`${origin}/presentation-text${query}`);
      for (const width of [767, 768, 769, 1023, 1024, 1025]) {
        await page.setViewportSize({ width, height: 900 });
        const results = [];
        for (const path of ["pattern", "html"]) {
          results.push(
            await page.locator(`[data-path=${path}]`).evaluate((root) => {
              const list = root.querySelector("ol");
              const heading = root.querySelector("h3");
              const button = root.querySelector(".wp-block-button__link");
              const style = getComputedStyle(button);
              return {
                list: {
                  start: list.start,
                  reversed: list.reversed,
                  text: [...list.childNodes]
                    .filter((node) => node.nodeType === Node.ELEMENT_NODE)
                    .map((node) =>
                      [...node.childNodes]
                        .filter((child) => child.nodeType === Node.TEXT_NODE)
                        .map((child) => child.textContent.trim())
                        .filter(Boolean)
                        .join(" "),
                    )
                    .join(" "),
                  nested: list.querySelector("li > ul > li")?.textContent.trim(),
                },
                heading: {
                  size: getComputedStyle(heading).fontSize,
                  color: getComputedStyle(heading).color,
                },
                button: {
                  text: button.textContent,
                  strong: button.querySelector("strong")?.textContent,
                  href: button.getAttribute("href"),
                  target: button.target,
                  rel: button.rel,
                  color: style.color,
                  background: style.backgroundColor,
                  padding: style.paddingInline,
                  radius: style.borderRadius,
                },
              };
            }),
          );
        }
        assert.deepEqual(
          results[0],
          results[1],
          `actual text body/pattern parity ${width}${query}`,
        );
        assert.equal(results[0].list.start, 3);
        assert.equal(results[0].list.reversed, true);
        assert.equal(results[0].list.nested, "Nested item");
        assert.equal(results[0].button.strong, "shopping");
        assert.equal(results[0].button.href, "/shop");
      }
    }
    console.log(
      "PASS actual b11b763 null-content ordered/nested List, rich Button and responsive typography body/pattern parity (both themes)",
    );
  } finally {
    await page.close();
  }
}
