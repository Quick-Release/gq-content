import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { MetadataImage } from "./metadata";

export interface MetadataHtmlExpectation {
  baseline: "OG-1";
  applicable: boolean;
  /** false checks preserved document basics while explicitly asserting OG is pending. */
  graph?: boolean;
  lang: string;
  dir: "ltr" | "rtl";
  robots: string;
  /** Required for applicable pages; supplied independently of resolver output. */
  title?: string;
  shareTitle?: string;
  canonical?: string;
  description?: string;
  siteName?: string;
  locale?: string;
  type?: "website" | "article";
  images?: readonly MetadataImage[];
  alternates?: readonly { lang: string; url: string }[];
  localeAlternates?: readonly string[];
  article?: { publishedTime?: string; modifiedTime?: string; authors?: readonly string[] };
}
type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];
const attr = (node: Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
const hasRel = (node: Element, rel: string) =>
  node.tagName === "link" && (attr(node, "rel") ?? "").toLowerCase().split(/\s+/u).includes(rel);
const isElement = (node: Node): node is Element => "tagName" in node;
const content = (node: Node): string =>
  "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(content).join("") : "";
/** Parses delivered bytes with HTML-standard tree construction, never resolver descriptors. */
export function inspectMetadataHtml(html: string, expected: MetadataHtmlExpectation): string[] {
  const issues: string[] = [];
  const document = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code !== "missing-doctype") issues.push(`HTML parse error: ${error.code}`);
    },
  });
  const all: Element[] = [];
  const walk = (node: Node) => {
    if (isElement(node)) all.push(node);
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(document);
  const root = all.find((node) => node.tagName === "html");
  const head = all.find((node) => node.tagName === "head");
  const equal = (label: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      issues.push(
        `${label}: expected ${JSON.stringify(wanted)}, received ${JSON.stringify(actual)}`,
      );
  };
  equal("baseline", expected.baseline, "OG-1");
  equal("html.lang", root && attr(root, "lang"), expected.lang);
  equal("html.dir", root && attr(root, "dir"), expected.dir);
  if (!head?.sourceCodeLocation?.startTag || !head.sourceCodeLocation.endTag)
    issues.push("Explicit complete head required in delivered HTML");
  const tags = all.filter((node) => ["title", "meta", "link"].includes(node.tagName));
  const relevant = tags.filter(
    (node) =>
      node.tagName === "title" ||
      /^(og:|article:)/u.test(attr(node, "property") ?? attr(node, "name") ?? "") ||
      ["description", "robots"].includes(attr(node, "name") ?? "") ||
      hasRel(node, "canonical") ||
      hasRel(node, "alternate"),
  );
  for (const node of relevant) {
    const location = node.sourceCodeLocation;
    if (
      node.parentNode !== head ||
      !location ||
      !head?.sourceCodeLocation?.endTag ||
      location.startOffset < head.sourceCodeLocation.startOffset ||
      location.endOffset > head.sourceCodeLocation.endTag.startOffset
    )
      issues.push(`Metadata outside actual head: ${node.tagName}`);
  }
  const metas = tags.filter((node) => node.tagName === "meta");
  const values = (key: string, attribute = "property") =>
    metas.filter((node) => attr(node, attribute) === key).map((node) => attr(node, "content"));
  const one = (key: string, wanted: string | undefined, attribute = "property") =>
    equal(key, values(key, attribute), wanted === undefined ? [] : [wanted]);
  one("robots", expected.robots, "name");
  const graph = metas.filter((node) =>
    /^(og:|article:)/u.test(attr(node, "property") ?? attr(node, "name") ?? ""),
  );
  const canonicals = tags.filter((node) => hasRel(node, "canonical"));
  // Attribute injection creates unexpected tags/attributes even when expected text survives.
  for (const node of relevant) {
    const allowedAttrs =
      node.tagName === "meta"
        ? ["name", "property", "content"]
        : node.tagName === "link"
          ? ["rel", "href", "hreflang"]
          : [];
    if (node.attrs.some((a) => !allowedAttrs.includes(a.name)))
      issues.push(`Unexpected attribute on ${node.tagName}`);
    if (node.tagName === "title" && node.childNodes.some(isElement))
      issues.push("Markup inside title");
  }
  if (!expected.applicable) {
    equal("excluded graph", graph.length, 0);
    equal("excluded canonical", canonicals.length, 0);
    equal(
      "excluded title",
      tags.filter((node) => node.tagName === "title").map(content),
      expected.title === undefined ? [] : [expected.title],
    );
    one("description", undefined, "name");
    equal("excluded alternates", tags.filter((node) => hasRel(node, "alternate")).length, 0);
    return issues;
  }
  if (expected.graph === false) {
    equal("pending graph", graph.length, 0);
    equal(
      "document title",
      tags.filter((node) => node.tagName === "title").map(content),
      expected.title === undefined ? [] : [expected.title],
    );
    equal(
      "canonical",
      canonicals.map((node) => attr(node, "href")),
      expected.canonical === undefined ? [] : [expected.canonical],
    );
    one("description", expected.description, "name");
    equal(
      "hreflang links",
      tags
        .filter((node) => hasRel(node, "alternate"))
        .map((node) => ({ lang: attr(node, "hreflang"), url: attr(node, "href") })),
      expected.alternates ?? [],
    );
    return issues;
  }
  for (const key of ["title", "canonical", "description", "siteName", "locale", "type"] as const)
    if (!expected[key]) issues.push(`Missing independent expectation: ${key}`);
  if (!expected.images?.length) issues.push("Missing independent image expectations");
  if (!/(?:^|\s)og:\s+https:\/\/ogp\.me\/ns#(?:\s|$)/u.test((root && attr(root, "prefix")) || ""))
    issues.push("Missing OG namespace");
  equal("document title", tags.filter((node) => node.tagName === "title").map(content), [
    expected.title,
  ]);
  equal(
    "canonical",
    canonicals.map((node) => attr(node, "href")),
    [expected.canonical],
  );
  one("description", expected.description, "name");
  for (const [key, value] of Object.entries({
    title: expected.shareTitle ?? expected.title,
    type: expected.type,
    url: expected.canonical,
    description: expected.description,
    site_name: expected.siteName,
    locale: expected.locale,
  }))
    one(`og:${key}`, value);
  const imageTags = graph.filter((node) => /^og:image(?::|$)/u.test(attr(node, "property") ?? ""));
  const wantedImages =
    expected.images?.flatMap((image) => [
      ["og:image", image.url],
      ["og:image:alt", image.alt],
      ["og:image:width", String(image.width)],
      ["og:image:height", String(image.height)],
      ...(image.type ? [["og:image:type", image.type]] : []),
    ]) ?? [];
  equal(
    "ordered image groups",
    imageTags.map((node) => [attr(node, "property"), attr(node, "content")]),
    wantedImages,
  );
  equal("locale alternates", values("og:locale:alternate"), expected.localeAlternates ?? []);
  equal(
    "hreflang links",
    tags
      .filter((node) => hasRel(node, "alternate"))
      .map((node) => ({ lang: attr(node, "hreflang"), url: attr(node, "href") })),
    expected.alternates ?? [],
  );
  one("article:published_time", expected.article?.publishedTime);
  one("article:modified_time", expected.article?.modifiedTime);
  equal("article authors", values("article:author"), expected.article?.authors ?? []);
  const allowed = new Set([
    "og:title",
    "og:type",
    "og:url",
    "og:description",
    "og:site_name",
    "og:locale",
    "og:locale:alternate",
    "og:image",
    "og:image:alt",
    "og:image:width",
    "og:image:height",
    "og:image:type",
    "article:published_time",
    "article:modified_time",
    "article:author",
  ]);
  for (const node of graph)
    if (!allowed.has(attr(node, "property") ?? ""))
      issues.push("Unexpected graph property or name-only OG tag");
  return issues;
}
export function assertMetadataHtml(html: string, expected: MetadataHtmlExpectation): void {
  const issues = inspectMetadataHtml(html, expected);
  if (issues.length) throw new Error(`Metadata HTML acceptance failed:\n${issues.join("\n")}`);
}
