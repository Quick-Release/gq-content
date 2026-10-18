import type { WordPressBlock } from "@getquick/content";

/** TEST ONLY: project contract metadata into WPGraphQL's HTML input shape.
 * Contract nodes are not CMS HTML. Callers supply shells for null content;
 * this deliberately does not implement Design rendering or resolve site data.
 */
export interface FixtureNode {
  name: string;
  attributes: Record<string, unknown>;
  content: string | null;
  children: FixtureNode[];
}

export function project(node: FixtureNode, shell = ""): WordPressBlock {
  return {
    name: node.name,
    attributes: node.attributes,
    htmlContent: node.content ?? shell,
    innerBlocks: node.children.map((child) => project(child)),
  };
}
