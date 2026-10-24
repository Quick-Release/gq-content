import { expect, test } from "vite-plus/test";
import { parseFragment } from "parse5";
import {
  renderDesignNavigation,
  navigationStyleSheet,
  renderDesignPattern,
} from "@getquick/content";
import fixtures from "./fixtures/navigation/neutral.json";

const fixture = (id: string) => fixtures.blocks.find((entry) => entry.fixture === id)!.node;

test("saved-null public Navigation preserves resolved menu order, identities and submenus", () => {
  const node = fixture("getquick-navigation");
  const html = renderDesignNavigation(node.name, node.attributes);
  expect(html).toContain('aria-label="Primary navigation"');
  expect(html).toContain('data-navigation-item="menu-item:16"');
  expect(html).toContain('href="/products"');
  expect(html).toContain('href="/shop"');
  expect(html.indexOf("Products</a>")).toBeLessThan(html.indexOf("Shop</a>"));
  expect(html.indexOf("Shop</a>")).toBeLessThan(html.indexOf("Contact</a>"));
  expect(parseFragment(html).childNodes).toHaveLength(1);
  expect(html).toContain('class="gqd-navigation__list"');
  expect(html).toContain('aria-expanded="false"');
});

test("native resolved items use native direct list targets and canonical child presentation without duplication", () => {
  const node = fixture("core-navigation-responsive");
  const html = renderDesignNavigation(
    node.name,
    { ...node.attributes, presentation: undefined },
    "",
  );

  expect(html).toContain('class="wp-block-navigation-link ');
  expect(html).toContain('class="wp-block-navigation-submenu ');
  expect(html).toContain("--gqd-base-paddingInline:calc(var(--gqd-spacing, 0.25rem) * 4)");
  expect(html).toContain('class="wp-block-navigation__submenu-container"');
  expect(html.match(/href="\/news"/g)).toHaveLength(1);
  expect(html).toContain('data-gqd-overlay="never"');
});

test("native inline children and resolved page-list retain semantic child identities and current links", () => {
  const pages = renderDesignNavigation("core/page-list", {
    items: [
      {
        id: "page:9",
        label: "Page",
        url: "/page",
        current: true,
        children: [{ id: "page:10", label: "Child", url: "/child" }],
      },
    ],
  });
  const submenu = renderDesignNavigation(
    "core/navigation-submenu",
    { label: "More", url: "/more" },
    pages,
  );
  const html = renderDesignNavigation("core/navigation", { overlayMenu: "never" }, submenu);
  expect(html).toContain('class="wp-block-page-list');
  expect(html).toContain('class="wp-block-pages-list__item');
  expect(html).toContain('data-navigation-item="page:10"');
  expect(html).toContain('aria-current="page"');
  expect(html.indexOf("/page")).toBeLessThan(html.indexOf("/child"));
});

test("Social Links retain resolved icon identity and accessible names, safely", () => {
  const node = fixture("getquick-social-links-populated");
  const html = renderDesignNavigation(node.name, node.attributes);
  expect(html).toContain('href="https://instagram.com/design.example"');
  expect(html).toContain('src="https://media.example/instagram.svg"');
  expect(html).toContain('data-social-service="bluesky"');
  expect(html).toContain("<svg");
  expect(html).toContain('aria-label="Bluesky"');
  const unsafe = renderDesignNavigation(node.name, {
    links: [
      {
        label: "<script>",
        url: "javascript:alert(1)",
        iconSvg: '<svg onload="alert(1)"><script>alert(1)</script><path d="M0 0"/></svg>',
      },
    ],
  });
  expect(unsafe).not.toContain("javascript:");
  expect(unsafe).not.toContain("onload");
  expect(unsafe).not.toContain("<script>");
});

test("Polylang resolved links preserve languages, direction, filtering and flag-only accessible names", () => {
  const links = [
    {
      slug: "en",
      locale: "en_US",
      label: "English",
      url: "/en/",
      flagUrl: "/en.svg",
      current: true,
      direction: "ltr",
      noTranslation: false,
    },
    {
      slug: "ar",
      locale: "ar",
      label: "العربية",
      url: "/ar/",
      flagUrl: "/ar.svg",
      current: false,
      direction: "rtl",
      noTranslation: false,
    },
    {
      slug: "pt",
      locale: "pt_PT",
      label: "Português",
      url: "/pt/",
      flagUrl: null,
      current: false,
      direction: "ltr",
      noTranslation: true,
    },
  ];
  const html = renderDesignNavigation("polylang/language-switcher", {
    links,
    dropdown: true,
    show_names: false,
    show_flags: true,
    hide_current: true,
    hide_if_no_translation: true,
    force_home: false,
  });
  expect(html).toContain("<details ");
  expect(html).toContain('href="/ar/"');
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('alt="العربية"');
  expect(html).toContain('href="/en/"');
  expect(html).toContain('href="/pt/"');
  expect(
    renderDesignNavigation("polylang/language-switcher", { links: [], dropdown: false }),
  ).not.toContain("<details ");
});

test("saved shells retain authored markup and unsupported settings fail at the canonical boundary", () => {
  const shell =
    '<nav class="wp-block-navigation" aria-label="Saved"><ul class="wp-block-navigation__container"><li><a href="/saved">Saved</a></li></ul></nav>';
  expect(renderDesignNavigation("core/navigation", {}, "", shell)).toContain('href="/saved"');
  expect(() =>
    renderDesignNavigation("core/navigation", { presentation: { base: { invented: "unsafe" } } }),
  ).toThrow();
  expect(navigationStyleSheet()).toContain("prefers-reduced-motion");
});

test("Social Links preserve the public wrapper anchor and authored class", () => {
  const node = fixture("getquick-social-links-populated");
  const html = renderDesignNavigation(node.name, node.attributes);
  expect(html).toContain('id="social"');
  expect(html).toContain("campaign-social");
});

test("custom resolved child presentation uses the native child identity without inventing a source-name field", () => {
  const html = renderDesignNavigation("getquick-design/navigation", {
    items: [
      {
        id: "navigation-item:1",
        label: "One",
        url: "/one",
        presentation: { base: { paddingInline: 4 } },
        children: [],
      },
    ],
  });
  expect(html).toContain("wp-block-navigation-link");
  expect(html).toContain("--gqd-base-paddingInline:");
  expect(html.match(/wp-block-getquick-design-navigation/g)).toHaveLength(1);
});

test("navigation interaction threshold uses the resolved Site theme", () => {
  expect(navigationStyleSheet({ breakpoints: { lg: "60rem" } })).toContain(
    "--gqd-navigation-breakpoint:60rem",
  );
});

test("native Page List Item consumes its public title/link attributes and link relationships stay safe", () => {
  const html = renderDesignNavigation("core/page-list-item", {
    id: 42,
    title: "Native page",
    link: "/native-page",
  });
  expect(html).toContain('href="/native-page"');
  expect(html).toContain("Native page</a>");
  const link = renderDesignNavigation("core/navigation-link", {
    label: "External",
    url: "https://example.test",
    opensInNewTab: true,
    rel: "author",
  });
  expect(link).toContain('target="_blank"');
  expect(link).toContain('rel="author noopener noreferrer"');
});

test("native Page List composition produces valid lists without removing its presentation wrapper", () => {
  const pages = renderDesignNavigation("core/page-list", {
    items: [{ id: "page:1", label: "Page", url: "/page" }],
  });
  const html = renderDesignNavigation("core/navigation", { overlayMenu: "never" }, pages);
  const tree = parseFragment(html);
  const visit = (node: (typeof tree.childNodes)[number]) => {
    if ("tagName" in node && ["ul", "ol"].includes(node.tagName)) {
      expect(
        node.childNodes
          .filter((child) => "tagName" in child)
          .every((child) => "tagName" in child && child.tagName === "li"),
      ).toBe(true);
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  tree.childNodes.forEach(visit);
  expect(html).toContain("wp-block-page-list");
});

test("client module is safe to import and clean up without a browser", async () => {
  const { mountDesignNavigation } = await import("@getquick/content/design/client");
  const cleanup = mountDesignNavigation();
  expect(() => {
    cleanup();
    cleanup();
  }).not.toThrow();
});

test("full native and custom responsive producer fixtures reach the public runtime", () => {
  for (const id of ["getquick-navigation-responsive", "core-navigation-responsive"]) {
    const node = fixture(id);
    const html = renderDesignPattern([node]);
    expect(html).toContain("data-gqd-navigation");
    expect(html).toContain("gqd-presentation");
    expect(html).toContain("--gqd-");
    expect(parseFragment(html).childNodes).toHaveLength(1);
  }
});

test("native child composition retains its Page List wrapper when resolved items are also delivered", () => {
  const pages = renderDesignNavigation("core/page-list", {
    items: [{ id: "page:1", label: "Page", url: "/page" }],
    presentation: { base: { paddingInline: 4 } },
  });
  const html = renderDesignNavigation(
    "core/navigation",
    { items: [{ id: "resolved:1", label: "Page", url: "/page" }] },
    pages,
  );
  expect(html).toContain("wp-block-page-list");
  expect(html.match(/href="\/page"/g)).toHaveLength(1);
  expect(html).toContain("--gqd-base-paddingInline:");
});

test("empty or completely filtered Polylang links render no navigation", () => {
  expect(renderDesignNavigation("polylang/language-switcher", { links: [], dropdown: true })).toBe(
    "",
  );
  expect(
    renderDesignNavigation("polylang/language-switcher", {
      links: [{ label: "English", slug: "en", locale: "en_US", current: true, url: "/en/" }],
      hide_current: true,
      dropdown: false,
    }),
  ).toBe("");
});

test("Polylang dropdown retains its current option even when lists hide the current language", () => {
  const html = renderDesignNavigation("polylang/language-switcher", {
    links: [{ label: "English", slug: "en", locale: "en_US", current: true, url: "/en/" }],
    dropdown: true,
    hide_current: true,
  });
  expect(html).toContain('href="/en/"');
  expect(html).toContain('aria-current="page"');
});

test("complete published native navigation gains the shared lifecycle without rebuilding filtered links", async () => {
  const { nativeNavigationShell } = await import("./fixtures/navigation/saved-shells");
  const html = renderDesignPattern([
    {
      name: "core/navigation",
      attributes: {
        overlayMenu: "always",
        openSubmenusOnClick: true,
        items: [{ label: "Unpublished", url: "/unpublished" }],
      },
      content: nativeNavigationShell,
      children: [
        {
          name: "core/navigation-link",
          attributes: { label: "Raw child", url: "/raw-child" },
          content: null,
          children: [],
        },
      ],
    },
  ]);
  expect(html).toContain('data-gqd-navigation=""');
  expect(html).toContain('data-gqd-overlay="always"');
  expect(html).toContain('data-gqd-submenu-visibility="click"');
  expect(html).toContain("data-gqd-navigation-open");
  expect(html).toContain("data-gqd-navigation-close");
  expect(html).toContain('aria-controls="published-panel"');
  expect(html.match(/data-gqd-submenu-list/g)).toHaveLength(2);
  expect(html.match(/data-gqd-submenu=""/g)).toHaveLength(2);
  expect(html).toContain(
    'href="/published" target="_blank" rel="author noopener" data-tracking="saved"><strong>Published</strong>',
  );
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('dir="rtl" data-owner="published"');
  expect(html.indexOf('href="/child"')).toBeLessThan(html.indexOf('href="/last"'));
  expect(html).not.toContain("/unpublished");
  expect(html).not.toContain("/raw-child");
});

test("canonical saved custom navigation keeps its owner structure and links while gaining modal controls", async () => {
  const { customNavigationShell } = await import("./fixtures/navigation/saved-shells");
  const html = renderDesignPattern([
    {
      name: "getquick-design/navigation",
      attributes: { overlayMenu: "always" },
      content: customNavigationShell,
      children: [],
    },
  ]);
  expect(html).toContain('data-getquick-navigation="true"');
  expect(html).toContain('class="gqd-navigation__landmark"');
  expect(html).toContain('data-gqd-navigation=""');
  expect(html).toContain('aria-controls="custom-panel"');
  expect(html).toContain('aria-controls="custom-submenu"');
  expect(html).toContain('data-gqd-navigation-close=""');
  expect(html.match(/href="\/published"/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Close menu"');
  expect(html).toContain('aria-current="page"');
});

test("saved native lists without overlay or submenu controls retain links and receive unique accessible controls", () => {
  const shell =
    '<nav class="wp-block-navigation"><ul class="wp-block-navigation__container"><li><a href="/parent"><em>Parent</em></a><ul class="wp-block-navigation__submenu-container"><li><a href="/child">Child</a></li></ul></li></ul></nav>';
  const first = renderDesignNavigation("core/navigation", { overlayMenu: "never" }, "", shell);
  const second = renderDesignNavigation("core/navigation", { overlayMenu: "never" }, "", shell);
  const ids = [...(first + second).matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  expect(ids).toHaveLength(4);
  expect(new Set(ids).size).toBe(4);
  expect(first).toContain('aria-label="Toggle submenu: Parent"');
  expect(first).toContain('href="/parent"><em>Parent</em>');
  expect(first).toContain('data-gqd-overlay="never"');
  for (const html of [first, second]) {
    for (const [, target] of html.matchAll(/aria-controls="([^"]+)"/g))
      expect(html).toContain(`id="${target}"`);
  }
});

test("ordinary delivered HTML enhancement is idempotent and retains authoritative native links", async () => {
  const { enhanceDesignNavigationHtml } = await import("@getquick/content");
  const { nativeNavigationShell } = await import("./fixtures/navigation/saved-shells");
  const original = `<main><p>Before</p>${nativeNavigationShell}<p>After</p></main>`;
  const once = enhanceDesignNavigationHtml(original);
  expect(once).toContain("data-gqd-navigation");
  expect(once).toContain('data-tracking="saved"');
  expect(once).toContain('href="/published"');
  expect(enhanceDesignNavigationHtml(once)).toBe(once);
});

test("ordinary overlay-disabled native HTML keeps visible links without inventing mobile overlay", async () => {
  const { enhanceDesignNavigationHtml } = await import("@getquick/content");
  const shell =
    '<nav class="wp-block-navigation"><ul class="wp-block-navigation__container"><li><a href="/published">Published</a></li></ul></nav>';
  expect(enhanceDesignNavigationHtml(shell)).toContain('data-gqd-overlay="never"');
  expect(renderDesignNavigation("core/navigation", { overlayMenu: "never" }, "", shell)).toContain(
    'data-gqd-overlay="never"',
  );
});

test("actual resolved force-home Language links survive missing translation metadata", async () => {
  const { readFileSync } = await import("node:fs");
  for (const lang of ["en", "fr"]) {
    const nodes = JSON.parse(
      readFileSync(
        new URL(`./fixtures/navigation/language/${lang}-nodes.json`, import.meta.url),
        "utf8",
      ),
    );
    for (const node of nodes) {
      const html = renderDesignPattern([node]);
      expect(html).not.toBe("");
      for (const entry of node.attributes.links) {
        expect(html).toContain(`href="${entry.url}"`);
        expect(html).toContain(entry.label);
      }
      expect(html).not.toContain("<img"); // Actual flags are null, never invent a bitmap.
    }
  }
});
