import { expect, test } from "vite-plus/test";
import { containerLayoutHtml } from "@getquick/content";

test("Container shell adapter adopts neutral presentation without restoring legacy layout", () => {
  const html = containerLayoutHtml('<section class="alignfull"><p>Kept</p></section>', {
    layout: { type: "constrained", contentSize: "600px", justifyContent: "center" },
    presentation: { base: { width: "full", marginInline: "auto" } },
  });
  expect(html).toContain('class="alignfull wp-block-getquick-design-container gqd-presentation"');
  expect(html).toContain("--gqd-base-marginInline:auto");
  expect(html).not.toContain("gqd-layout");
  expect(html).toContain("<p>Kept</p>");
});
