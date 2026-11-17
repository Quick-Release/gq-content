export interface Preset {
  slug: string;
}

export type SpacingPreset = Preset & { size: string };
export type ColorPreset = Preset & { color: string };
export type GradientPreset = Preset & { gradient: string };
export interface BlockPresetStyles {
  vars: Record<string, string>;
  colorRules: string;
}

const validSlug = (slug: string) => /^[a-z0-9][a-z0-9-]*$/.test(slug);
/** A CSS value safe inside a stylesheet: a color or length, nothing that ends a rule. */
const safeValue = (value: string) => /^[#(),.%\w\s-]+$/.test(value);
/** A selector for the content's container: classes, ids, elements and descendants. */
const validScope = (scope: string) => /^[.#]?[A-Za-z][\w-]*(?:[ .#>][A-Za-z][\w-]*)*$/.test(scope);

/** The preset lists a page is served with (DesignPresets' fields). */
export interface PresetLists {
  spacingSizes?: SpacingPreset[];
  colors?: ColorPreset[];
  gradients?: GradientPreset[];
}

/** A CSS gradient safe inside a stylesheet: one gradient function, nothing that ends a rule. */
const safeGradient = (value: string) =>
  /^(?:repeating-)?(?:linear|radial|conic)-gradient\([#(),.%\w\s/+-]+\)$/.test(value.trim()) &&
  !value.includes("/*");

function presetLists(
  first: PresetLists | SpacingPreset[] | null | undefined,
  colors: ColorPreset[] | undefined,
  gradients: GradientPreset[] | undefined,
): Required<PresetLists> {
  if (Array.isArray(first))
    return { spacingSizes: first, colors: colors ?? [], gradients: gradients ?? [] };
  return {
    spacingSizes: first?.spacingSizes ?? [],
    colors: first?.colors ?? [],
    gradients: first?.gradients ?? [],
  };
}

/**
 * WordPress preset classes need the CMS palette and gradients as well as CSS
 * variables. Pass the page's design presets (an entry or home content), or
 * the lists themselves. `scope` is the content's container (`.prose-wp` by
 * default; another for content a Site renders itself). Gradients with an
 * invalid slug, or a value that isn't one CSS gradient, are left out.
 */
export function blockPresetStyles(
  presets: PresetLists | null | undefined,
  scope?: string,
): BlockPresetStyles;
export function blockPresetStyles(
  spacingSizes: SpacingPreset[],
  colors: ColorPreset[],
  scope?: string,
  gradients?: GradientPreset[],
): BlockPresetStyles;
export function blockPresetStyles(
  first: PresetLists | SpacingPreset[] | null | undefined,
  second?: ColorPreset[] | string,
  third?: string,
  fourth?: GradientPreset[],
): BlockPresetStyles {
  const positional = Array.isArray(first);
  const scope = (positional ? third : (second as string | undefined)) ?? ".prose-wp";
  const { spacingSizes, colors, gradients } = presetLists(
    first,
    positional ? (second as ColorPreset[] | undefined) : undefined,
    positional ? fourth : undefined,
  );
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

  for (const { slug, gradient } of gradients) {
    if (!validSlug(slug) || !safeGradient(gradient)) continue;
    vars[`--wp--preset--gradient--${slug}`] = gradient.trim();
    colorRules.push(
      `${scope} .has-${slug}-gradient-background{background:var(--wp--preset--gradient--${slug})}`,
    );
  }

  return { vars, colorRules: colorRules.join("\n") };
}

/**
 * The design presets as WordPress defines them, on `:root`, for styles that
 * read the palette, gradients and spacing from these variables outside the
 * content's container. Pass the page's design presets, or the lists
 * themselves. Presets with an invalid slug, or a value that could end the
 * rule, are left out; "" without any.
 */
export function presetRootStyle(presets: PresetLists | null | undefined): string;
export function presetRootStyle(
  spacingSizes: SpacingPreset[],
  colors: ColorPreset[],
  gradients?: GradientPreset[],
): string;
export function presetRootStyle(
  first: PresetLists | SpacingPreset[] | null | undefined,
  second?: ColorPreset[],
  third?: GradientPreset[],
): string {
  const { spacingSizes, colors, gradients } = presetLists(first, second, third);
  const declarations = [
    ...spacingSizes
      .filter(({ slug, size }) => validSlug(slug) && safeValue(size))
      .map(({ slug, size }) => `--wp--preset--spacing--${slug}:${size}`),
    ...colors
      .filter(({ slug, color }) => validSlug(slug) && safeValue(color))
      .map(({ slug, color }) => `--wp--preset--color--${slug}:${color}`),
    ...gradients
      .filter(({ slug, gradient }) => validSlug(slug) && safeGradient(gradient))
      .map(({ slug, gradient }) => `--wp--preset--gradient--${slug}:${gradient.trim()}`),
  ];
  return declarations.length ? `:root{${declarations.join(";")}}` : "";
}
