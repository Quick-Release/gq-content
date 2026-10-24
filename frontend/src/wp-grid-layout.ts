import { presentationHtml, presentationStyleSheet } from "./presentation";
export const DESIGN_GRID = "getquick-design/grid";

/** Apply the canonical neutral Grid model; legacy device counts are discarded. */
export function gridLayoutHtml(html: string, attributes: Record<string, unknown>): string {
  return presentationHtml(
    DESIGN_GRID,
    html || '<div class="wp-block-getquick-design-grid"></div>',
    attributes.presentation,
    { attributes },
  );
}

/** Complete shared CSS, retained under the Grid helper's public name. */
export function designGridStyle(): string {
  return presentationStyleSheet();
}
