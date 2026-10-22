export interface Preset {
  slug: string;
}

export type SpacingPreset = Preset & { size: string };
export type ColorPreset = Preset & { color: string };
export interface BlockPresetStyles {
  vars: Record<string, string>;
  colorRules: string;
}

const validSlug = (slug: string) => /^[a-z0-9][a-z0-9-]*$/.test(slug);
/** A CSS value safe inside a stylesheet: a color or length, nothing that ends a rule. */
const safeValue = (value: string) => /^[#(),.%\w\s-]+$/.test(value);
/** A selector for the content's container: classes, ids, elements and descendants. */
const validScope = (scope: string) => /^[.#]?[A-Za-z][\w-]*(?:[ .#>][A-Za-z][\w-]*)*$/.test(scope);

/**
 * WordPress preset classes need the CMS palette as well as CSS variables.
 * `scope` is the content's container (`.prose-wp` by default; another for
 * content a Site renders itself).
 */
export function blockPresetStyles(
  spacingSizes: SpacingPreset[],
  colors: ColorPreset[],
  scope = ".prose-wp",
): BlockPresetStyles {
  if (!validScope(scope)) throw new Error(`${JSON.stringify(scope)} isn't a container selector`);
  const vars: Record<string, string> = {};
  const colorRules: string[] = [];

  for (const { slug, size } of spacingSizes) {
    if (validSlug(slug)) vars[`--wp--preset--spacing--${slug}`] = size;
  }

  for (const { slug, color } of colors) {
    if (!validSlug(slug)) continue;
    vars[`--wp--preset--color--${slug}`] = color;
    colorRules.push(
      `${scope} .has-${slug}-color{color:var(--wp--preset--color--${slug})}`,
      `${scope} .has-${slug}-background-color{background-color:var(--wp--preset--color--${slug})}`,
      `${scope} .has-${slug}-color.has-link-color a{color:var(--wp--preset--color--${slug})}`,
    );
  }

  return { vars, colorRules: colorRules.join("\n") };
}

/**
 * The design presets as WordPress defines them, on `:root`, for styles that
 * read the palette and spacing from these variables outside the content's
 * container. Presets with an invalid slug, or a value that could end the
 * rule, are left out; "" without any.
 */
export function presetRootStyle(spacingSizes: SpacingPreset[], colors: ColorPreset[]): string {
  const declarations = [
    ...spacingSizes
      .filter(({ slug, size }) => validSlug(slug) && safeValue(size))
      .map(({ slug, size }) => `--wp--preset--spacing--${slug}:${size}`),
    ...colors
      .filter(({ slug, color }) => validSlug(slug) && safeValue(color))
      .map(({ slug, color }) => `--wp--preset--color--${slug}:${color}`),
  ];
  return declarations.length ? `:root{${declarations.join(";")}}` : "";
}
