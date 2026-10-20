# @getquick/content

The configured content runtime for WordPress HTML and WPGraphQL. This slice
provides pure helpers, the configured WordPress client, durable delivery and
installed SQL migrations, event/refresh HTTP handlers, and the Site chrome's
designed header and footer. Release notes: [0.2.0](../docs/releases/0.2.0.md).

```ts
import { renderWordPressBlocks, htmlLang } from "@getquick/content";
import { createContentRuntime } from "@getquick/content/server";

const content = createContentRuntime({
  site: "my Site identity",
  graphqlEndpoint: "https://cms.example.test/wp/graphql",
  cmsOrigin: "https://cms.example.test",
  wordpress: {
    locale: "pt_PT_ao90",
    languages: [{ locale: "en_US", slug: "en" }],
  },
  isServer: () => true, // Supply the framework's lazy server-context check.
  bindings: () => ({}), // Supply fresh request bindings, including optional credentials.
});
const home = await content.wordpress.getHomeContent(content.defaultLanguage);
const entry = await content.wordpress.getEntryByUri("/about/");
const chrome = await content.wordpress.getSiteChrome("https://www.example.test", {
  language: content.routeLanguage("/en/about/"),
});
```

The Site supplies all configuration: no manifest, framework environment or
Cloudflare discovery is imported. Construct per request where practical. A
long-lived instance calls its binding getter on every delivery operation and CMS request. Keep the
GraphQL read identity separate from automation identities. Partial credential
pairs fail before transport. With credentials, only the configured HTTPS CMS
origin at `/graphql` or `/wp/graphql`, without URL userinfo, is allowed. Reads use
manual redirects and an eight-second deadline; failed reads return unavailable,
confirmed absence returns missing, and successful reads return found.

The root entry contains pure helpers and public structural types. The server
entry exports `createContentRuntime`, `ContentConfig`, `ContentBindings`,
`ContentRuntime` and `WordPressClient`. Runtime properties contain languages,
routing functions and the WordPress methods; credentials/configuration are kept
in closures. Language configuration retains the source's normalization policy,
and routing returns the same language objects held in that instance's array.

The reusable client methods retain their argument order:

- `getHomeContent(language?)`
- `getEntryByUri(uri)`
- `getDesignPresets()`
- `getPublishedEntries()`
- `getPublishedRoutes()`
- `getSiteChrome(siteOrigin?, { location?, language? }?)`

From the repository root, use `vp install` and `vp run validate`. Validation
builds compiled ESM/declarations through Vite+ Pack, checks formatting/lint/types,
runs package-boundary suites, then packs and installs in a disposable consumer
without private registry configuration. `vp run test` rebuilds before tests;
`vp test frontend/tests/wordpress-access.test.ts` is useful after an explicit
`vp pack` during a focused implementation cycle. Build output is intentionally
untracked. The npm tarball allowlist contains only compiled output, the five original SQL migrations and package
metadata (npm also includes this README).

The public delivery methods are `publishedHome(siteOrigin?, language?)`,
`publishedEntry(path, siteOrigin?)` and `pageChrome(siteOrigin?, route?)`. Supply a
`PUBLICATION_DB` structural binding to serve durable publications. Stored reads
need no event or refresh secret and retain last-known-good content without an
age limit. Cold entry lookups read the CMS once, preserving missing versus
unavailable, canonical routes, language isolation and conditional promotion.
Production without a store returns unavailable (chrome returns null). Only
`development: true` enables live reads without a store. A store failure never
activates that fallback. All public reads guard server context before bindings
or transport.

## Designed header and footer

Editors design the header and footer per GQ Design route in GETQUICK → Design
→ Header & Footer (GQ Design 0.4.2+). The chrome read fetches every built-in
route's selection (`designPattern`) and stores it in the chrome row, so pages
read it from the store like the menu and the logo. Each delivery returns the
chrome with its own route's `header` and `footer` (`DesignPattern`: a title and
its blocks as `WordPressBlock`s), absent where the route has none:

| Page                                      | Route (`designRouteKey`) |
| ----------------------------------------- | ------------------------ |
| A language's front page (`publishedHome`) | `front-page`             |
| The posts page                            | `home`                   |
| A post                                    | `single-post`            |
| A page                                    | `page`                   |
| An entry of another post type             | `single`                 |
| A listing / search page the Site adds     | `archive` / `search`     |
| A 404, or `pageChrome` without a route    | `page`                   |

```ts
import { renderSiteFooter, renderSiteHeader, designMenuItems } from "@getquick/content";

// A Site renders its own blocks by name, here and in content alike.
const renderers = {
  "getquick/header-navigation": (block) =>
    `<nav>${designMenuItems(block.attributes?.menuItems)
      .map((item) => `<a href="${item.href}">${item.label}</a>`)
      .join("")}</nav>`,
};
const header = renderSiteHeader(chrome, { renderers }); // "<header class=\"gq-site-header\">…" or null
const footer = renderSiteFooter(chrome, { renderers }); // "<footer class=\"gq-site-footer\">…" or null
```

Null means the page's route has no designed region, or the CMS has no
`designPattern` field (the chrome is then read again without it): keep the
Site's own logo-and-menu header. The [0.2.0 release notes](../docs/releases/0.2.0.md)
give the layout change. `renderWordPressBlocks(blocks, { renderers })`
accepts the same renderers for content. A selected pattern that GQ Design
resolves to no blocks fails the chrome read, which keeps the stored chrome.

The chrome is refreshed by a shared `patterns` settings event. The CMS sends it
when a synced pattern, template, template part or navigation menu is saved, trashed or deleted,
when a menu a pattern's block shows is saved, and when the theme switches. The
Frontend then rereads every language's chrome and no entry. A `menus` or
`logo` event rereads the chrome too, patterns included, and reconciliation
compares it. See [ADR 0003](../docs/adr/0003-serve-each-routes-designed-header-and-footer-with-the-site-chrome.md).

## Migrations

Infrastructure imports the Node-only migration entry separately:

```ts
import { migrationsDirectory } from "@getquick/content/migrations";
// Alchemy beta.79: Cloudflare.D1.Database("Publications", {
//   migrations: migrationsDirectory,
// });
```

The exported string resolves to the five SQL files inside the installed package.
Keep this infrastructure entry out of browser and Worker imports. The root/server
graphs contain no Node migration module. `vp run alchemy` packs/installs with pnpm
and exercises the pinned Alchemy local D1/Worker lifecycle, including an update
with unchanged migration identities and publication data. This proof uses local
workerd, no remote resources or credentials. See the repository's issue #4 evidence.

The HTTP methods are `handleEvent(request, { siteOrigin? }?)` and
`handleRefresh(request, { siteOrigin? }?)`, both returning standard `Response`s.
Sites wire their POST routes directly to these methods; other methods return
405 with `Allow: POST`. Responses use `Cache-Control: no-store`.

Events require `PUBLICATION_EVENT_SECRET` and refresh requires
`FRONTEND_REFRESH_TOKEN`, each at least 32 characters, plus `PUBLICATION_DB`.
An absent or short credential disables its handler without disabling stored
public reads. Event HMAC verification and Site/schema checks precede any CMS
reads or store changes. Refresh uses bearer authorization; `{}` refreshes the
whole Site and `{"uris":["/about/"]}` targets 1–100 entry paths. Language homes
require a whole-Site refresh. A signed withdrawal hides every stored route of
that entry immediately, without reading the CMS. Refreshes cannot lift it;
only a later publication can.

Signed `reconcile` events compare canonical shared rows and the complete
published-entry list, repair differences through normal publication rules, and
rotate rereads of unchanged entries. Runs hold a D1 lease, reserve a bounded CMS
request budget, and persist outcomes and pending counts for continuation.
Responses retain the source protocol: 200 for `reconciled`, `behind` or `busy`;
503 for `failed`, preserving last-known-good content. Incomplete lists remove
nothing. Every configured language has separate home/chrome rows; design is
shared.

Signed `check` events return `{ status: "checked", site, reconciliation, store }`.
`store` reports shared row states, entry-state counts, active withdrawals and
failed events, plus other language row states under `languages`. It is null
when unavailable. `reconciliation` reports the last run, counts, failure and
last matched time, or null before any run. These are runtime evidence for the
Blueprint readiness gate; readiness orchestration, media checks and provisioning
remain Blueprint-owned. No storage or reconciliation helpers are public exports.

`vp run pair` exercises installed WordPress/package transport; `vp run alchemy`
retains the local installed-package/workerd migration and protocol proof.
`vp run reconciliation` additionally installs the pair and runs actual
WordPress/Polylang CLI and scheduler HTTP into the installed workerd consumer,
using GraphQL answers projected from real CMS state. It verifies convergence,
partial runs, outages/recovery and complete pending/failed records across Worker
updates. Full P6 release evidence remains issue #11.
