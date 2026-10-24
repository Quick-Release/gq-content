import { expect, test } from "vite-plus/test";
import {
  renderDesignCarousel,
  renderDesignCarouselItem,
  renderDesignPattern,
  renderWordPressBlocks,
} from "@getquick/content";

const slide = "getquick-design/slider";
const carousel = "getquick-design/sliders";
const navigation = "getquick-design/carousel-navigation";

test("Carousel public renderer preserves ordered linked media/content and renders saved-null navigation", () => {
  const attributes = {
    imageUrl: "/first.jpg",
    imageId: 42,
    imageAlt: "First image",
    linkUrl: "/first",
  };
  const first = renderDesignCarouselItem(attributes, "<h2>First</h2>");
  const html = renderDesignCarousel({}, [
    { name: slide, attributes, html: first },
    { name: slide, html: renderDesignCarouselItem({}, "<p>Second</p>") },
    {
      name: navigation,
      attributes: { visible: true, showArrows: true, navigationType: "lines" },
      html: "",
    },
  ]);
  expect(html).toContain('href="/first"');
  expect(html).toContain('alt="First image"');
  expect(html).toContain('class="wp-image-42"');
  expect(html.indexOf("First</h2>")).toBeLessThan(html.indexOf("Second</p>"));
  expect(html).toContain('aria-label="Previous slide"');
  expect(html).toContain('aria-label="Next slide"');
  expect(html).toContain('aria-label="Go to slide 2"');
  expect(html).toContain("data-gqd-carousel");
  expect(html.match(/src="\/first.jpg"/g)).toHaveLength(1);
});

test("neutral pattern and parsed WordPress Carousel render through the same public adapter", () => {
  const attrs = { imageUrl: "/one.jpg", imageAlt: "One", linkUrl: "/one" };
  const pattern = renderDesignPattern([
    {
      name: carousel,
      attributes: {},
      content: null,
      children: [
        {
          name: slide,
          attributes: attrs,
          content: null,
          children: [
            { name: "core/heading", attributes: {}, content: "<h2>One</h2>", children: [] },
          ],
        },
        { name: navigation, attributes: {}, content: null, children: [] },
      ],
    },
  ]);
  const parsed = renderWordPressBlocks([
    {
      name: carousel,
      attributes: {},
      innerBlocks: [
        {
          name: slide,
          attributes: attrs,
          innerBlocks: [{ name: "core/heading", htmlContent: "<h2>One</h2>" }],
        },
        { name: navigation, attributes: {} },
      ],
    },
  ]);
  expect(parsed).toBe(pattern);
  expect(parsed).toContain('alt="One"');
  expect(parsed).toContain('aria-label="Go to slide 1"');
});
