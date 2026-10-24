import { presentationHtml } from "./presentation";

export type ContainerAttributes = Record<string, unknown>;

/** Container shell adapter. Layout uses the shared neutral presentation model. */
export function containerLayoutHtml(html: string, attributes: ContainerAttributes): string {
  return presentationHtml(
    "getquick-design/container",
    html || '<div class="wp-block-getquick-design-container"></div>',
    attributes.presentation,
    { attributes },
  );
}
