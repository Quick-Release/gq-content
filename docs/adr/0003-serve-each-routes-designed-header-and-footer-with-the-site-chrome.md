# Serve each route's designed header and footer with the Site chrome

Status: accepted, 2026-10-20.

GQ Design 0.4.2 lets editors give each design route (`front-page`, `home`,
`single-post`, `page`, `single`, `archive`, `search`) its own header and
footer on GETQUICK → Design → Header & Footer. `designPattern(template, slot)`
returns the selected published synced pattern's `title` and `blocksJson` (the
layout API's block tree, nested patterns inlined, menu-backed Site blocks given
their `menuItems`), or null when the region uses an ordinary template part.
GQ Design's [template selection contract](https://github.com/Quick-Release/gq-design/blob/main/docs/template-selection.md)
says which route a page is served with. The Frontend chooses the route; GQ
Design never sees the URL.

## Decision

- **The patterns are part of the chrome.** The chrome read asks for every
  built-in route's header and footer (14 aliased `designPattern` fields) beside
  the menu, logo and icon, and the chrome row stores each route's selection as
  `designPatterns`. So the patterns are promoted, retained, refreshed and
  reconciled by the chrome's rules: last-known-good without an age limit,
  conditional promotion, one row per language. There is no new table, key or
  migration, and the row's format stays 1. Every page reads its patterns from
  D1, never from a live WordPress call.
- **The route is chosen per page.** `designRouteKey` applies the contract's
  table. An entry records its route when it is read (`designRoute`: a post is
  `single-post`, a page is `page`, the posts page is `home`). Delivery serves
  each page the chrome with its route's `header` and `footer` only: the front
  page is `front-page`, a 404 is `page`, and a page the Site adds itself
  passes its route to `pageChrome`. Older entry rows without `designRoute` are
  a post if they have a date, else a page.
- **Only the built-in routes are read.** A Site route registered with
  `getquick_design_template_definitions` would need the manifest, which GQ
  Design serves only to signed-in users. A null result is final for its route:
  no other route is tried.
- **No designed header changes nothing.** A route without a pattern, a CMS
  whose `designPattern` field is missing (a GraphQL "Cannot query field"
  error, which the chrome read answers by reading again without the patterns),
  or an answer without the fields stores and serves exactly today's chrome.
  `renderSiteHeader`/`renderSiteFooter` then return null, and the Site's layout
  keeps its own logo-and-menu markup.
- **A selected pattern that resolves to no blocks fails the read.** GQ Design
  answers an invalid, cyclic or oversized tree with `blocksJson: "[]"` rather
  than an error. Promoting that would replace a working header with nothing,
  so the stored chrome is kept and the failure reported, like any failed read.
  An intentionally empty pattern can't be told apart and is treated the same.
- **Patterns render as content renders.** Each layout node becomes a content
  block (`WordPressBlock`): its saved `content` is its `htmlContent`, a
  container's saved wrapper is rebuilt from its name and attributes (GQ Design
  sends saved HTML only for blocks without children), and its children are its
  inner blocks. `renderWordPressBlocks` renders them. Its new `renderers`
  option lets a Site render its own blocks, such as `getquick/header-navigation`,
  by name, wherever they appear, so a Site block renders the same in a pattern
  as in content. `designMenuItems` turns a menu-backed block's `menuItems` into
  the chrome's menu tree. The store holds the tree, not HTML, so a Site's
  renderers apply without a refresh.
- **A `patterns` settings event refreshes the chrome.** The CMS sends one
  shared `patterns` event when any of these is saved, trashed or deleted: a
  synced pattern (`wp_block`), a template (`wp_template`, which names a route's
  header and footer part), a template part (`wp_template_part`, which
  selects the pattern), or a navigation menu (`wp_navigation`, which a core
  Navigation block shows). It sends one when the theme switches. It also sends
  one when a menu saves that a pattern's menu-backed block shows (its
  `"menuId":N` in their content), unless that menu's own `menus` event already
  refreshes every language's chrome. The Frontend refreshes every language's
  chrome row and no entry, so the change reaches every page at once.
  Reconciliation compares the chrome rows, so a missed event, or a change
  without one (a menu item's linked page unpublished), is repaired on the next
  run.

## Consequences

- `designPattern` takes no language, so every language is served the default
  language's selection, with menus resolved without a language. GQ Design
  needs a language argument before multilingual Sites can serve translated
  patterns.
- A Site block GQ Design doesn't support (not declared with
  `getquick_design_block_definitions`) arrives without its attributes. The
  read logs it and still serves the block. nomia-bnq's
  `getquick/header-navigation` is undeclared today, so it renders without a
  menu.
- Saved inline styles of a container with children (custom colours, spacing)
  aren't in the layout API, so the rebuilt wrapper carries only its classes.
  Such a container needs a Site renderer until GQ Design sends the wrapper.
- `SiteChrome` gains optional `header`, `footer` and `designPatterns`, and
  `EntryContent` an optional `designRoute`. Code that builds them is unaffected.
