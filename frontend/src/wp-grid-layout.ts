/** GQ Design's saved Grid contract (blocks/grid/{block.json,index.js,style.css}). */
export const DESIGN_GRID = "getquick-design/grid";

const columnCount = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6
    ? value
    : fallback;

/** Restore the classes omitted by the pattern serializer. Saved content shells
 * already have these classes and remain authoritative, including block supports. */
export function gridLayoutHtml(html: string, attributes: Record<string, unknown>): string {
  const columns = [
    ["gqd-grid--", columnCount(attributes.columns, 3)],
    ["gqd-grid--tablet-", columnCount(attributes.tabletColumns, 2)],
    ["gqd-grid--mobile-", columnCount(attributes.mobileColumns, 1)],
  ] as const;
  const shell = html || '<div class="wp-block-getquick-design-grid"></div>';
  return shell.replace(/^(\s*<div\b)([^>]*)(>)/i, (_, tag: string, props: string, end: string) => {
    const existing = props.match(/\sclass="([^"]*)"/)?.[1] ?? "";
    const classes = columns
      .filter(([prefix]) => !new RegExp(`(?:^|\\s)${prefix}[1-6](?:\\s|$)`).test(existing))
      .map(([prefix, count]) => `${prefix}${count}`);
    if (!classes.length) return `${tag}${props}${end}`;
    props = /\sclass="/.test(props)
      ? props.replace(/(\sclass=")([^"]*)"/, `$1$2 ${classes.join(" ")}"`)
      : `${props} class="wp-block-getquick-design-grid ${classes.join(" ")}"`;
    return `${tag}${props}${end}`;
  });
}

/** Install once in the document's stylesheet (chrome and content). No CMS values
 * enter this CSS. Breakpoints and track sizing match GQ Design's Grid stylesheet. */
export function designGridStyle(): string {
  const grid = ".wp-block-getquick-design-grid";
  const tracks = (prefix: string) =>
    Array.from({ length: 6 }, (_, index) => {
      const count = index + 1;
      return `${grid}.${prefix}${count}{grid-template-columns:repeat(${count},minmax(0,1fr))}`;
    }).join("\n");
  return [
    `${grid}{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}`,
    `${grid}>*{min-width:0;margin-block:0}`,
    `@media (width < 48rem){${tracks("gqd-grid--mobile-")}}`,
    `@media (48rem <= width < 64rem){${tracks("gqd-grid--tablet-")}}`,
    `@media (width >= 64rem){${tracks("gqd-grid--")}}`,
  ].join("\n");
}
