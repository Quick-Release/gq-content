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

const gradients = [
  { slug: "title-band", gradient: "linear-gradient(90deg, #cde5e3 0%, rgba(255,255,255,0) 100%)" },
  {
    slug: "sky-to-mint",
    gradient: "radial-gradient(circle at right center, #66b8d9 0%, #cde5e3 100%)",
  },
  { slug: "bad", gradient: "linear-gradient(red, blue);}body{display:none" },
  { slug: "comment", gradient: "linear-gradient(red /* x */, blue)" },
  { slug: "not-a-gradient", gradient: "url(https://evil.example/x.png)" },
];

test("gradient presets get their variables and has-<slug>-gradient-background classes", () => {
  const { vars, colorRules } = blockPresetStyles({
    spacingSizes: [{ slug: "md", size: "2rem" }],
    colors: [{ slug: "accent", color: "#2563eb" }],
    gradients,
  });
  expect(vars).toEqual({
    "--wp--preset--spacing--md": "2rem",
    "--wp--preset--color--accent": "#2563eb",
    "--wp--preset--gradient--title-band": gradients[0]!.gradient,
    "--wp--preset--gradient--sky-to-mint": gradients[1]!.gradient,
  });
  expect(colorRules).toContain(
    ".prose-wp .has-title-band-gradient-background{background:var(--wp--preset--gradient--title-band)}",
  );
  expect(colorRules).not.toContain("bad");
  expect(colorRules).not.toContain("comment");
  // The positional form takes them after the scope.
  expect(blockPresetStyles([], [], ".site-blocks", gradients.slice(0, 1)).colorRules).toBe(
    ".site-blocks .has-title-band-gradient-background{background:var(--wp--preset--gradient--title-band)}",
  );
  // Presets stored before gradients were delivered have none.
  expect(blockPresetStyles({ spacingSizes: [], colors: [] }, ".site-blocks")).toEqual({
    vars: {},
    colorRules: "",
  });
  expect(blockPresetStyles(null)).toEqual({ vars: {}, colorRules: "" });
});

test("gradient presets are declared on :root too", () => {
  expect(presetRootStyle({ gradients })).toBe(
    `:root{--wp--preset--gradient--title-band:${gradients[0]!.gradient};--wp--preset--gradient--sky-to-mint:${gradients[1]!.gradient}}`,
  );
  expect(presetRootStyle([], [], gradients.slice(1, 2))).toBe(
    `:root{--wp--preset--gradient--sky-to-mint:${gradients[1]!.gradient}}`,
  );
  expect(presetRootStyle(undefined)).toBe("");
});
