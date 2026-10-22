import { expect, test } from "vite-plus/test";
import { blockPresetStyles, presetRootStyle } from "@getquick/content";

test("exposes CMS spacing and colors to saved WordPress block classes", () => {
  const { vars, colorRules } = blockPresetStyles(
    [{ slug: "md", size: "2rem" }],
    [{ slug: "accent", color: "#2563eb" }],
  );

  expect(vars).toEqual({
    "--wp--preset--spacing--md": "2rem",
    "--wp--preset--color--accent": "#2563eb",
  });
  expect(colorRules).toContain(
    ".prose-wp .has-accent-color{color:var(--wp--preset--color--accent)}",
  );
  expect(colorRules).toContain(
    ".prose-wp .has-accent-background-color{background-color:var(--wp--preset--color--accent)}",
  );
  expect(colorRules).toContain(
    ".prose-wp .has-accent-color.has-link-color a{color:var(--wp--preset--color--accent)}",
  );
});

test("rejects unsafe token slugs before building CSS selectors", () => {
  const styles = blockPresetStyles([], [{ slug: "a}body{display:none", color: "red" }]);
  expect(styles).toEqual({ vars: {}, colorRules: "" });
});

test("scopes the preset classes to another content container", () => {
  const { colorRules } = blockPresetStyles(
    [],
    [{ slug: "accent", color: "#2563eb" }],
    ".site-blocks",
  );
  expect(colorRules).toContain(
    ".site-blocks .has-accent-color{color:var(--wp--preset--color--accent)}",
  );
  expect(colorRules).not.toContain(".prose-wp");
  expect(() => blockPresetStyles([], [], ".a{}body")).toThrow("isn't a container selector");
});

test("declares the presets on :root, leaving out values that could end the rule", () => {
  expect(
    presetRootStyle(
      [
        { slug: "md", size: "clamp(1rem, 2vw, 2rem)" },
        { slug: "bad", size: "1rem;}body{display:none" },
      ],
      [
        { slug: "accent", color: "#2563eb" },
        { slug: "a}b", color: "red" },
      ],
    ),
  ).toBe(
    ":root{--wp--preset--spacing--md:clamp(1rem, 2vw, 2rem);--wp--preset--color--accent:#2563eb}",
  );
  expect(presetRootStyle([], [])).toBe("");
});
