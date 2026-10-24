import { expect, test } from "vite-plus/test";
import {
  enhanceDesignCoverVideosHtml,
  renderDesignPattern,
  renderWordPressBlocks,
} from "@getquick/content";

const shell =
  '<div class="wp-block-cover"><video class="wp-block-cover__video-background" autoplay muted loop playsinline src="/movie.webm" poster="/poster.jpg"></video><div class="wp-block-cover__inner-container"><a href="#next">Next</a></div></div>';

test("saved Cover media is motion-gated without changing sources, poster or foreground", () => {
  const html = enhanceDesignCoverVideosHtml(shell);
  expect(html).not.toContain("autoplay");
  expect(html).toContain('src="/movie.webm"');
  expect(html).toContain('poster="/poster.jpg"');
  expect(html).toContain('<a href="#next">Next</a>');
  expect(enhanceDesignCoverVideosHtml(html)).toBe(html);
});

test("Cover gating preserves independent native video and foreground video policy", () => {
  const independent = '<video autoplay src="/ordinary.webm"></video>';
  const foreground =
    '<div class="wp-block-cover"><div class="wp-block-cover__inner-container"><video autoplay src="/content.webm"></video></div></div>';
  expect(enhanceDesignCoverVideosHtml(independent)).toBe(independent);
  expect(enhanceDesignCoverVideosHtml(foreground)).toBe(foreground);
});

test("neutral, saved and parsed Cover paths share the non-eager playback policy", () => {
  const node = {
    name: "core/cover",
    attributes: { backgroundType: "video", url: "/movie.webm" },
    content: null,
    children: [],
  };
  for (const html of [
    renderDesignPattern([node]),
    renderDesignPattern([{ ...node, content: shell }]),
    renderWordPressBlocks([{ name: "core/cover", dynamicContent: shell }]),
  ]) {
    expect(html).toContain("<video");
    expect(html).not.toContain("autoplay");
  }
});
