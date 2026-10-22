# @getquick/content

The configured content runtime for WordPress HTML and WPGraphQL. This slice
provides pure helpers, the configured WordPress client, durable delivery and
installed SQL migrations, and event/refresh HTTP handlers. It is released as a
pair with the Composer package `getquick/gq-content`, at the same version and tag.

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
entry exports `createContentRuntime`, `ContentConfig`, `ContentExtension`,
`ExtensionNode`, `CollectionConfig`, `ContentBindings`, `ContentRuntime` and `WordPressClient`. Runtime properties contain languages,
routing functions and the WordPress methods; credentials/configuration are kept
in closures. Language configuration retains the source's normalization policy,
and routing returns the same language objects held in that instance's array.

The reusable client methods retain their argument order:

- `getHomeContent(language?)`
- `getEntryByUri(uri)`
- `getDesignPresets()`
- `getPublishedEntries()`
- `getPublishedRoutes()`
- `getArchives()`
- `getSiteChrome(siteOrigin?, { location?, language? }?)`

From the repository root, use `vp install` and `vp run validate`. Validation
builds compiled ESM/declarations through Vite+ Pack, checks formatting/lint/types,
runs package-boundary suites, then packs and installs in a disposable consumer
without private registry configuration. `vp run test` rebuilds before tests;
`vp test frontend/tests/wordpress-access.test.ts` is useful after an explicit
`vp pack` during a focused implementation cycle. Build output is intentionally
untracked. The npm tarball allowlist contains only compiled output, the five original SQL migrations, the
separate consent database migrations and package metadata (npm also includes this README).

The public delivery methods are `publishedHome(siteOrigin?, language?)`,
`publishedEntry(path, siteOrigin?)`, `pageChrome(siteOrigin?)` and
`designPresets()`. Supply a
`PUBLICATION_DB` structural binding to serve durable publications. Stored reads
need no event or refresh secret and retain last-known-good content without an
age limit. Cold entry lookups read the CMS once, preserving missing versus
unavailable, canonical routes, language isolation and conditional promotion.
Production without a store returns unavailable (chrome returns null). Only
`development: true` enables live reads without a store. A store failure never
activates that fallback. All public reads guard server context before bindings
or transport.

`designPresets()` returns the stored design presets for a page that isn't a
publication (live only in explicit development, null otherwise), and
`internalOrigins(siteOrigin?)` the origins `menuItemHref` treats as this Site's.
`blockPresetStyles(spacing, colors, scope?)` scopes the preset classes to a
container (`.prose-wp` by default); `presetRootStyle(spacing, colors)` declares
the presets on `:root`.

## A Site's own content

A Site whose WordPress plugin adds fields to its pages and posts declares them
as an `extension`. The runtime reads them with each front page, page and post
(with its blocks), stores the Site's value with the publication and serves it,
typed, through outages:

```ts
const content = createContentRuntime<SiteBlocks>({
  // …the configuration above…
  extension: {
    fields: { page: "wpBlocksJson pageBackgroundColor", post: "wpBlocksJson" },
    // The Site's value for a node WordPress returned, or undefined for none.
    read: ({ kind, fields }) => siteBlocks(fields.wpBlocksJson, fields.pageBackgroundColor),
    // The stored value (JSON) read back, or undefined when it can't be served.
    parse: (stored) => storedSiteBlocks.safeParse(stored).data,
  },
});
const page = await content.publishedEntry("/about/");
if (page.kind === "found" && page.content.entry.extension) {
  // Render page.content.entry.extension (SiteBlocks); the front page's is
  // home.page.extension.
}
```

Rows stored before the Site declared it serve without it; a refresh stores it.
A read throwing fails as WordPress's answer not matching the schema, and a read
without its blocks stores nothing, so the stored page stays served. See ADR 0004.

## Collections and archive Pages

A Site stores its custom post types' items as collections, and lists them from
the publication store alone (never WordPress), for an archive Page's listing
block:

```ts
const content = createContentRuntime({
  // …the configuration above…
  collections: {
    biblioteca: {
      postType: "biblioteca", // WordPress's name
      graphqlType: "Biblioteca", // its graphql_single_name
      taxonomies: ["categoria_biblioteca"], // each show_in_graphql
    },
  },
});
const page = await content.list({
  collection: "biblioteca",
  terms: { categoria_biblioteca: ["legislacao"] }, // any slug; every taxonomy
  search: "lei", // title and excerpt, ignoring case and accents
  page: 1,
  perPage: 12,
});
// { kind: "found", items: [{ uri, title, date, modifiedAt, excerpt,
//   featuredImage, terms, extension?, language? }], total, page, pages }
// or { kind: "unavailable", failure }
const filters = await content.terms("biblioteca", "categoria_biblioteca");
// { kind: "found", terms: [{ slug, name, count }] }
const archive = await content.archiveUri("biblioteca"); // "/biblioteca/" or null
```

Items are entries: events, withdrawals and reconciliation keep them, and
`publishedEntry` serves them with `entry.collection` (`name`, `terms`). The
extension's `fields.collections[<name>]` selects an item's own fields (`read`
gets `kind: "item"` and `collection`). In WordPress, GETQUICK → Archives
assigns each type a Page, which takes over the type's archive address. A
type or taxonomy WPGraphQL doesn't show fails the archives read, by name. See
ADR 0005.

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

## Consent and legal links

CONSENT-1/LEGAL-1 ship as isolated entries: `@getquick/content/consent`
(neutral core), `/consent/client` (browser runtime), `/consent/server` (the
`/gq/consent` record and read endpoints and purge), `/consent/migrations`
(the separate consent database), `/consent/astro` (default UI and legal
footer as HTML) and `/consent/testing` (acceptance suite). They import no
content runtime, framework or WordPress client. Passing
`consent: { services: ["youtube"], cmsSettings: true }` to
`createContentRuntime` rewrites third-party embeds into consent placeholders
at delivery and stores gq-config's Legal Contract and GA4 settings in each
language's chrome; `runtime.consentConfiguration(chrome)` returns the page's
consent configuration. See the repository's `docs/consent.md`.
