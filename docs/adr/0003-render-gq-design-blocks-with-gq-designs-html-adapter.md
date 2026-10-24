# Render GQ Design blocks with gq-design's HTML adapter

Status: proposed, 2026-10-24.

## Context

Content Frontends render WordPress's HTML. The Frontend passes WPGraphQL's
rendered `content` through unchanged, except on pages that contain a Video
Hero. For those it rebuilds the whole page from WPGraphQL's block tree
(`renderWordPressBlocks`). That reassembles each block's saved `htmlContent`,
builds Video Hero markup itself and re-implements Container layout
(`wp-container-layout.ts`). It never uses `dynamicContent`, so dynamic blocks
on those pages render from their saved shell only.

[gq-site ADR 0018](https://github.com/Quick-Release/gq-site/blob/main/docs/adr/0018-ship-gq-designs-contract-and-renderer-as-lockstep-packages.md)
kept that model. Its decisions were:

- Content keeps WordPress HTML.
- `@quick-release/design-renderer` never creates markup.
- Each commerce Site owns its React adapter.
- No Astro adapter is written while content renders HTML.

It left moving content to contract nodes to this repository.
[ADR 0001](0001-release-the-content-runtime-as-a-configured-package-pair.md)
restated that the public `@getquick/content` artifact has no private design
dependency.

That model splits the HTML of GETQUICK's own blocks across two owners. Its
editor-side markup and contract live in gq-design. Its content-side markup
lives here as hand-written string assembly, verified against gq-design's
fixtures after the fact. Every presentation change therefore needs matching
work in both repositories. The coordinated Tailwind presentation release
([gq-design#72](https://github.com/Quick-Release/gq-design/issues/72), ADR 0004
there) already requires each block family to update "WordPress HTML/content
helpers" alongside its adapters.

The platform targets hundreds of client Sites. At that scale the HTML of
GETQUICK blocks must have one owner and one versioned, fixture-tested
implementation. It must be upgradable fleet-wide without per-Site markup.

## Decision

### gq-design owns the HTML of its blocks

gq-design ships an HTML adapter for every enabled `getquick-design/*` block in
its manifest. The adapter turns Design contract nodes into HTML strings and is
framework-neutral, with no React, Astro, DOM or Node runtime dependency, so it
runs in a Worker. It is released in lockstep with the plugin and contract.
Its fixtures are the HTML contract for those blocks.

gq-content writes no markup for gq-design blocks. The Video Hero markup and
Container layout code here are removed once the adapter covers them.

This supersedes gq-site ADR 0018 in two respects: the renderer package gains
an HTML adapter, and content no longer renders gq-design blocks from WordPress
HTML. Commerce Sites keep their own React adapters and may adopt the HTML
adapter later.

### Render per block, with WordPress HTML as the fallback

The Frontend composes a page block by block:

- A gq-design block the adapter covers is rendered by the adapter.
- Every other block (core, third-party, Site-specific) uses WordPress's HTML:
  `dynamicContent` when present, otherwise `htmlContent`.
- A gq-design block the adapter cannot render falls back to its WordPress HTML
  and is reported through the runtime's issue reporting, never silently
  dropped. That covers unknown attributes, a newer block version than the
  adapter knows, or failed validation.

This applies to every page, not only Video Hero pages.

### The public package takes the adapter by injection

`@getquick/content` keeps no runtime, peer or type dependency on private design
packages (ADR 0001). The configured Frontend instance accepts block renderers
keyed by block name, through a structural interface it defines. The Site's
Frontend wiring imports gq-design's adapter and passes it in. Whether that
adapter is published publicly, or Sites receive registry read access, is
gq-design's packaging decision.

### Store block data; render when serving

The publication store holds each entry's node tree and per-block fallback HTML
in a new publication format, not rendered page HTML. The Frontend renders when
it serves the entry, with the adapter version it is deployed with. A renderer
fix then reaches every stored page on deploy, not only pages republished
afterwards.

Migrations stay additive (ADR 0002's store rules hold). During the transition
the Worker serves both formats: it serves the current format's rows as before,
and refresh and reconciliation rewrite them into the new format. Rendered-HTML
caching, if request-time rendering exceeds the Worker budget, is an
implementation choice. Its cache key must include the adapter version.

### Pair versions per Site and keep the contract additive

On each Site, the CMS plugin and the Frontend's adapter come from the same
gq-design release, pinned exactly (gq-site ADR 0018). Within a contract major
version, block attribute changes are additive. Each node identifies the block
version that produced it. An adapter that meets a newer version falls back to
WordPress HTML.

The fleet upgrade order is: plugin first, then Frontend. Between the two
deploys a Site serves fallback HTML for changed blocks, not wrong markup. The
runtime's manifest comparison reports the drift.

## Consequences

- One implementation of GETQUICK block markup serves every content Site.
  Accessibility, performance and Tailwind presentation changes land once, in
  the repository that owns the block.
- gq-design must serialize, for content, every attribute its adapter needs.
  Its own research
  ([headless block support](https://github.com/Quick-Release/gq-design/blob/main/docs/research/headless-block-support.md))
  records where it currently does not: Grid columns, Video Hero media and
  Social Links profiles.
- The content read moves from WPGraphQL's block shape to gq-design's
  `getquickBlocksJson`, which must carry WordPress HTML per node for the
  fallback.
- Gutenberg's editor rendering and the adapter's HTML are two renderings of the
  same block in one repository. gq-design's shared saved-document fixtures must
  hold them in parity.
- A publication format change and a fleet rollout of paired versions are
  required. Sites not yet migrated keep serving their stored format.
- Core and third-party blocks continue to depend on WordPress's markup and theme
  CSS. This ADR does not attempt to own them.

### Read block data through WPGraphQL

The Frontend reads the block tree from gq-design's `getquickBlocksJson` field on
`Post` and `Page`, in the same WPGraphQL query it already makes for content,
design tokens, settings and translations. gq-design's REST field
`getquickBlocks` is built by the same reader and carries the same data, so the
choice is about transport only.

GraphQL keeps one request per entry read. REST would need separate requests
for the entry, tokens, settings and translations, which lengthens refreshes
and spends more of reconciliation's request budget. Visitor latency is
unaffected either way: visitors are served from the publication store, and
the CMS is read only on publication, reconciliation and cold lookup. Staying
on WPGraphQL also keeps a single CMS client, with its credential and
destination rules already proven.

The whole-page `content` field is no longer needed once pages are composed per
block. Dropping it from the query should reduce the CMS's rendering work per
read, since blocks are currently rendered both there and in `dynamicContent`.
That saving is to be measured, not assumed.

### Ship the Tailwind release first

The coordinated Tailwind release
([gq-design#82](https://github.com/Quick-Release/gq-design/issues/82)) is
nearly complete and is not delayed by this decision. Its content-helper
changes land here as planned. The HTML adapter is built afterwards against the
Tailwind presentation model, and it then replaces those helpers. The cost is
that each Tailwind family's content-side markup is written twice, in exchange
for not holding back a release that is almost done.

## Open questions

- **Existing Sites.** Generated Sites keep their copied helpers (issue #2).
  Their migration to the adapter is a separate rollout decision.
