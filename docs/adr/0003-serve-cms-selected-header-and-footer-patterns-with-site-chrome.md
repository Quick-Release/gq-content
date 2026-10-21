# Serve CMS-selected header and footer patterns with the Site chrome

Status: accepted, 2026-10-19.

GQ Design's Header & Footer lets editors select a published synced pattern for
a design route's header and footer. `designPattern(template, slot)` returns
its `title` and `blocksJson` (the layout API's block tree, with synced patterns
inlined and Site serializers applied, such as `getquick/header-navigation`'s
`menuItems`), or null when the region uses an ordinary template part.

## Decision

- **The patterns are part of the chrome.** The chrome read asks for
  `header` and `footer` beside the menu, logo and icon, and the chrome row
  stores them. They are promoted, retained and refreshed with it, by its
  rules: last-known-good without an age limit, conditional promotion, and one
  row per language. No new table, key or migration; the row's format stays 1.
- **One design route per Site.** `ContentConfig.designTemplate` names the
  route (default `page`) whose selection every page is served with, as every
  page already shares one menu. Per-route chrome would need a row per route
  and language and is not built until a Site needs it.
- **A selected pattern that resolves to no blocks fails the read.** GQ Design
  answers an invalid, cyclic or oversized tree with `blocksJson: "[]"` rather
  than an error. Promoting that would replace a working header with nothing,
  so the stored chrome is kept and the failure reported, as for any schema
  failure. A malformed node anywhere also fails the entire tree; it is never
  silently dropped to promote a partial header or footer. An intentionally empty pattern is indistinguishable and is treated
  the same way.
- **Older rows stay servable.** Chrome stored before this change has no
  `header` or `footer`; it is served with both null (the Site's own regions)
  until the next refresh or reconciliation, which compares and promotes it.
  Older Workers ignore the new fields.
- **The Site renders, the runtime parses.** The store holds the block tree,
  not HTML, so a Site's block renderers apply without a refresh.
  `renderDesignPattern` renders saved HTML, a built-in `core/site-logo`, and
  the Site's renderers by block name; a block with none of those renders its
  children and is reported. `designMenuItems` turns a block's menu attribute
  into the same tree as the chrome's menu, with links made safe and internal.
  Content Sites install no `@quick-release/*` package (gq-site ADR 0018), so
  this seam has no design-package dependency.
- **A `patterns` settings event refreshes the chrome.** The CMS sends it when
  a synced pattern, template or template part is saved or deleted, or the
  theme changes, or pattern sync eligibility changes. It also consumes GQ
  Design's public `getquick_design_cache_invalidated` hook, so linked-page,
  media and serializer dependencies refresh the chrome too. Repeated hooks
  coalesce into one event per request. Reconciliation compares the full
  chrome, so a missed event is repaired on the next run.

## Consequences

- A CMS without GQ Design's `designPattern` field fails every chrome read.
  Content Sites already require GQ Design (`designTokens`).
- `designPattern` takes no language: every language receives the provider's
  unqualified selection; nested references and Site serializers are not given
  the requested language. This is an explicit shared-data exception to ADR
  0002's language-specific chrome: the ordinary menu and store row remain
  language-specific, and failed reads never copy another language's row.
  Translated patterns are blocked by
  [gq-design #53](https://github.com/Quick-Release/gq-design/issues/53);
  this runtime does not implement a translation workaround.
- `SiteChrome` gains two required fields, a type change for code that builds
  one.

## Provider contract verified for this change

[GQ Design's selection contract](https://github.com/Quick-Release/gq-design/blob/v0.4.2/docs/template-selection.md)
is explicit: each route has its own selection, an unknown route also returns
null, and a null result is final rather than a reason to try another route.
This runtime deliberately uses one configured selection globally; it does not
infer a route from each content URL. Editors can use **Use on every route** in
Design when matching the native layouts is desired; the runtime does not
perform that management action. Choose a registered key from Design's manifest.
The default `page` requires GQ Design 0.4.1 or newer (0.4.0 only registered
`single-post`); `single` and `search` require 0.4.2.

Public selection requires published route and template-part sources (or the
provider's public file/registered fallback) and a published synced,
non-password-protected final pattern. Viewer capability and password cookies
do not unlock it. GQ Design owns these restrictions and tests them with real
WPGraphQL; the runtime consumes the public field and treats authoritative null
as removal of its stored pattern on the next successful read. A failed read
retains last-known-good content, including when the CMS is unreachable after a
selection changes. There is no separate pattern-withdrawal protocol.
