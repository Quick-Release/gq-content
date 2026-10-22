import {
  resolveMetadata,
  renderMetadataHead,
  type MetadataInput,
  type ResolvedMetadata,
  type HeadDescriptor,
} from "@getquick/content/metadata";
import {
  mapPublishedContentMetadata,
  type ContentMetadataOptions,
} from "@getquick/content/metadata/content";
import {
  assertMetadataHtml,
  type MetadataHtmlExpectation,
} from "@getquick/content/metadata/testing";
const site: MetadataInput["site"] = {
  origin: "https://example.com",
  name: "Example",
  title: "Home",
  description: "Public summary",
  language: { lang: "en-GB", locale: "en_GB", dir: "ltr" },
};
const options: ContentMetadataOptions = { site, route: "/" };
const input: MetadataInput = mapPublishedContentMetadata({ title: "Home" }, options);
const metadata: ResolvedMetadata = resolveMetadata(input);
const descriptors: HeadDescriptor[] = metadata.head;
const expected: MetadataHtmlExpectation = {
  baseline: "OG-1",
  applicable: true,
  graph: false,
  lang: "en-GB",
  dir: "ltr",
  robots: "index, follow",
  title: "Home",
  canonical: "https://example.com/",
  description: "Public summary",
};
assertMetadataHtml(
  `<html lang="en-GB" dir="ltr"><head>${renderMetadataHead(metadata)}</head></html>`,
  expected,
);
void descriptors;
