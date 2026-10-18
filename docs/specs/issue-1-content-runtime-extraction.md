# Extract and release the configured content runtime pair

Implementation contract for [gq-content #1](https://github.com/Quick-Release/gq-content/issues/1).
Design decisions accepted on 2026-10-17. Implementation has not started.
This incorporates [#2](https://github.com/Quick-Release/gq-content/issues/2)
within the same cut; #2 is not a second extraction or an upstream blocker for #1.

## Outcome and checkpoint

Release `getquick/gq-content` (private Composer registry, WordPress must-use
plugin) and `@getquick/content` (public npm) at **0.1.0**, from one `v0.1.0` tag.
Use `cms/` and `frontend/` package directories. Keep this repository's history;
start the extracted source history fresh and record provenance by commit/path.

The reviewed gq-site checkpoint is
`eaec13488d57b3d04059309b5b36de5d016f3de1`:
[source](https://github.com/Quick-Release/gq-site/tree/eaec13488d57b3d04059309b5b36de5d016f3de1).
Before extracting, verify its relevant paths have not changed upstream. A newer
checkpoint requires an explicit delta review and updated provenance; do not
silently extract whichever files happen to be current. Until the cut, no new
content-runtime work starts in gq-site.

[gq-platform ADR 0001](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0001-ownership-of-work-across-getquick-repositories.md)
governs ownership. [gq-site ADR 0018](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0018-ship-gq-designs-contract-and-renderer-as-lockstep-packages.md)
supersedes #1's original renderer exclusion: content keeps WPGraphQL and
WordPress HTML, with its HTML helpers in this public package.

## Extraction inventory

From `blueprint/templates/apps/cms/web/app/mu-plugins/`:

- `publication-events.php`, `settings-events.php`, `delivery-retries.php`.
- Their runtime-owned real WordPress, WP-CLI, retry and cron assertions.

From `blueprint/templates/apps/frontend/`:

- `src/lib/{events,delivery,publications,reconciliation,wordpress,site-language}.ts`.
- `src/lib/{wp-block-renderer,wp-block-styles,wp-container-layout}.ts`.
- All five SQL files, byte-for-byte and with their original names:
  `0001_publications.sql`, `0002_entries.sql`, `0003_publication_events.sql`,
  `0004_withdrawals.sql`, `0005_reconciliation.sql`.
- All six library suites: `wp-block-renderer.test.ts`, `wp-block-styles.test.ts`,
  `wp-container-layout.test.ts`, `wordpress.test.ts`, `wordpress-access.test.ts`,
  `site-language.test.ts`.
- Runtime assertions from `src/{homepage,entries,routes,events,withdrawals,settings,retries,reconciliation,languages,language-updates}.test.ts`,
  plus private test support in `src/test/{sqlite-d1,wordpress-stub}.ts`.
- Protocol behavior currently inside `src/pages/gq/{events,refresh}.ts`:
  authorization, validation, dispatch, status mapping, no-store/Allow headers.
  Extract this behavior into framework-neutral package HTTP handlers.

Also account for runtime portions of gq-site's
`scripts/smoke/frontend-runtime.{sh,mjs}`, `frontend-runtime-lib.mjs`,
`cms-events.{sh,mjs}`, `frontend-languages.mjs` and `cms-polylang.{sh,mjs}`.
Keep a source-assertion-to-new-home inventory: these suites mix runtime
guarantees with skeleton rendering and provisioning. Preserve runtime assertions
at the package boundary; do not copy the whole Site skeleton into package tests.
Blueprint presentation/generation assertions remain Blueprint-owned and are
named in the hand-off. A small package test consumer is appropriate.

## Public Frontend contract

Use compiled ESM and declarations with an explicit export map. No dependency
on Astro or a consuming Site's files/environment is needed in published runtime.
Replace `astro/zod` with a direct public validation dependency; keep schemas and
validation-library types out of the public API. Use the current Platform Vite+
toolchain policy, including library packaging, while retaining PHP/framework
checks where applicable.

- `@getquick/content`: pure HTML/language/formatting helpers and public types.
- `@getquick/content/server`: `createContentRuntime(config)` and its types.
- `@getquick/content/migrations`: infra-only `migrationsDirectory: string`,
  resolved relative to the installed package. Ship all five SQL files. This
  Node entry must not enter the Worker/browser runtime dependency graph.

The factory accepts this configuration shape; equivalent internal organization
is allowed without changing the consumer guarantees:

```ts
interface ContentConfig {
  site: string;
  graphqlEndpoint: string;
  cmsOrigin: string;
  wordpress?: {
    locale?: string;
    languages?: readonly { locale: string; slug: string }[];
  };
  development?: boolean; // false by default
  isServer: () => boolean;
  bindings: () => ContentBindings | Promise<ContentBindings>;
  fetch?: typeof globalThis.fetch;
}

interface ContentBindings {
  PUBLICATION_DB?: SqlDatabase;
  FRONTEND_REFRESH_TOKEN?: string;
  PUBLICATION_EVENT_SECRET?: string;
  GQ_AUTH_GRAPHQL_CLIENT_ID?: string;
  GQ_AUTH_GRAPHQL_CLIENT_SECRET?: string;
}
```

`site` is a trimmed nonempty string, compared exactly with the CMS identity.
Preserve the manifest's accepted identity domain; do not impose the narrower
slug rule used by `gq new`. Endpoint and CMS origin are explicit, with no
template/local-development fallback inside the package. Preserve current
language normalization and routing; do not add a new language-validation policy
as incidental extraction work.

The runtime exposes:

- One canonical `languages` array, `defaultLanguage`, `multilingual`,
  `routeLanguage(route)` and `isLanguageHome(route)`. Routing, defaults and
  returned alternates reuse that instance's language objects: current Site
  consumers compare their identities.
- `publishedHome(siteOrigin?, language?)`, `publishedEntry(path, siteOrigin?)`
  and `pageChrome(siteOrigin?)`, preserving their existing result contracts.
- `handleEvent(request, { siteOrigin? }?)` and
  `handleRefresh(request, { siteOrigin? }?)`, returning standard `Response`s.
  Preserve the existing wire behavior, validation order, status/body shapes,
  `Cache-Control: no-store`, authentication challenges and 405 responses.
- `wordpress`: the reusable configured client, with existing method names and
  argument order: `getHomeContent(language?)`, `getEntryByUri(uri)`,
  `getDesignPresets()`, `getPublishedEntries()`, `getPublishedRoutes()` and
  `getSiteChrome(siteOrigin?, { location?, language? }?)`.

Pure exports include `parseWordPressBlocks`, `renderWordPressBlocks`,
`hasVideoHero`, `blockPresetStyles`, `containerLayoutHtml`,
`containerChildLayoutHtml`, `htmlLang`, `siteLanguages`, `languageSubject`,
`routeOf`, `responseStatus` and `formatDate`. Export their input/result types,
client/content types, `Delivery` variants, page-delivery types, `SiteLanguage`,
`SiteChrome`, `Alternate`, `WordPressBlock` and the structural database types
needed for bindings. Internal refresh authority, signature, ordering, budget
and storage functions need not become public merely because source files
currently export them. Do not expose secrets through public instance properties.

### Server and failure guarantees

The Site owns manifest loading, endpoint environment lookup, SSR/dev flags and
Cloudflare binding discovery. It supplies a lazy server guard and binding
getter, preferably constructing the runtime per request. Even a long-lived
instance must obtain fresh bindings per operation; do not cache the first
request's credentials/database in global state. Instances cannot share mutable
configuration, language state or credentials.

Check server context **before** loading bindings or invoking transport.
Browser reads must return the existing safe failure without binding access or
fetch. Merely naming an entry `server` is insufficient; verify the behavior.
Keep current secret-safe failure messages and the eight-second client timeout,
manual redirects, GraphQL/schema validation and block fallback/recovery.

GraphQL credentials remain optional and paired. A partial pair fails before
fetch. With credentials, require the configured HTTPS CMS origin, no URL
userinfo, and `/graphql` or `/wp/graphql`; never forward credentials elsewhere
or follow redirects. Keep public and automation credentials separate.

Missing refresh/event secrets refuse the corresponding handlers without
preventing stored public content from being served. Their current minimum
length is 32. No database means unavailable/not-ready in production. Only
explicit `development: true` enables current live CMS delivery without a store;
it does not weaken credential destination checks. Store errors never trigger
an implicit production CMS fallback.

Preserve the refresh protocol's 100-URI limit, path/JSON/unknown-field
validation and language-home rejection. Preserve the event body's 16 KiB
limit, five-minute signing window, action/schema checks and ordering rules.

## CMS configuration, loading and extension contract

Package a `wordpress-muplugin` with one documented entry point loading all
three modules exactly once. Prove actual Bedrock loading rather than relying
on alphabetical discovery of three loose files.

Replace both templated Site constants with `GQ_CONTENT_SITE_ID`: read a PHP
constant first, otherwise the same-named process environment variable, require
a string and trim it. A defined invalid constant does not fall through. Accept
any nonempty identity that the manifest accepts; never infer one from a URL or
database. It must equal `ContentConfig.site`.

Preserve endpoint lookup through `getquick_config_frontend_url()` and then
`GETQUICK_FRONTEND_URL`, plus `PUBLICATION_EVENT_SECRET`. Missing/invalid Site
identity must never send a malformed or guessed event, break WordPress saves,
or claim successful delivery. Unconfigured development may skip automatic
events; production reports a safe configuration failure through CLI/Site
Health, without storing malformed event envelopes. Keep persisted record keys
and wire formats intact for correctly configured instances.

Supported filters, retaining existing argument/result semantics:

- `gq_events_deliveries`: array of delivery rows with `subject`, `label`,
  `event`, `delivery`, `deliver(array $event): array` and optional `post`.
  The callback owns recording its outcome. This is scheduler extension, not
  an extension of the Frontend's accepted event schema.
- `gq_publication_events_timeout`: publication delivery timeout, currently 15 seconds.
- `gq_events_reconcile`: boolean enabling reconciliation, default true.

`gq_events_now` remains a testing seam. Other PHP functions/constants and core
WordPress callback registrations are not supported package extension APIs.
No new custom emitted actions or arbitrary post-type support are required.

Add `wp gq-events version`, returning the bare version; support `--format=json`
as `{ "package": "getquick/gq-content", "version": "0.1.0" }`. It works
without event configuration. Add package/version/configured state to Site
Health debug information. Preserve existing CLI commands/output contracts,
health test identity and delivery reporting; surface invalid identity as a
configuration failure. Keep `wp gq-events retry-due --quiet` compatible with
the existing server cron.

## Runtime ADRs and ownership

Restate the final combined runtime decisions from gq-site ADRs 0003–0009 and
0013, plus runtime diagnostics/interfaces from 0010. Account for later
amendments rather than copying contradictory historical text:

- Durable last-known-good content without an age limit; malformed/unknown
  stored formats fail safely; confirmed missing differs from unavailable.
- Cold entry lookup, moved routes, conditional promotion, immediate withdrawal
  and protection from older/in-flight refreshes.
- Signed publish/withdraw/settings/reconcile/check events, durable identities,
  retry/supersede behavior and shared design presets.
- CMS delivery records, deleted-entry records, editor diagnostics, bounded
  retries, scheduler lease and secret-safe reporting.
- Budgeted/leased reconciliation, canonical comparisons, complete-list rules,
  rotating rereads and language-specific home/chrome/settings without fallback.

ADRs 0011/0012's offboarding/code-hosting workflows stay in gq-site. So do
`gq site check` orchestration, independent-media checks and provisioning.
Retain their interface obligations without moving the CLI or infrastructure.
This repository's ADRs describe ownership/decisions, not proof completion.

## Compatibility and runnable proof gates

All of these are required before the pair is declared released. They are
identified requirements, **not evidence already collected**.

- [ ] **P1 — Installed migration path:** pack/install with pnpm, import the
  infra-only migration path, and use the pinned Alchemy local D1 lifecycle to
  apply 0001–0005 before Worker update. Repeat with no reapplication and
  preserve stored publication data and migration identities. Existing Wrangler
  smoke alone does not answer this. If Alchemy cannot use the path, stop for a
  migration hand-off decision; do not silently copy SQL into the Site.
- [ ] **P2 — Installed MU-plugin:** install the release ZIP through real
  composer/installers and roots/bedrock-autoloader 1.1.0; bootstrap WordPress
  and WP-CLI. Verify module loading once/in order, configured identity,
  publication/settings delivery, retry/reconcile commands, cron compatibility,
  configuration failure behavior and CLI/Site Health versions.
- [ ] **P3 — Public npm consumer:** install the packed package in a clean
  consumer without private registry credentials; typecheck exports and run
  helpers/server integration. Inspect the artifact for private imports/types,
  fixtures, tests, credentials, Site imports and unresolved placeholders/env.
  Browser/server imports must not pull in the Node migration entry.
- [ ] **P4 — Access and isolation:** migrate every `wordpress-access` assertion
  to the package boundary; prove browser rejection before bindings/fetch,
  partial-pair rejection, HTTPS origin/path restrictions, manual redirects,
  secret-safe errors/logs and two configured instances with isolated state.
  Check binding freshness and canonical language object identity.
- [ ] **P5 — Published fixture compatibility:** pin an actually published
  `@quick-release/design-contract` version as a dev dependency. Verify this
  repository's CI read access and exported manifest/block fixtures. Exercise
  relevant block names/attributes/layout through a test-only projection;
  retain the WPGraphQL HTML tests. No runtime/peer/optional dependency on any
  private design package, no private declaration imports, and no import of
  `@quick-release/design-renderer`, even for tests. Fixtures and credentials
  must not enter either release artifact or generated Sites.
- [ ] **P6 — Package runtime regression:** migrated runtime suites and actual
  WordPress/cron, multilingual and workerd consumer smoke preserve HTML,
  outages, restart/redeploy persistence, moves, withdrawals, recovery,
  language isolation and protocol behavior. Record assertion allocation and
  evidence; Node SQLite tests alone are insufficient.
- [ ] **P7 — Publication recovery:** inject failure after one publication step;
  retry the same release, skip matching completed stages and reject mismatched
  artifacts. Verify both registries serve the intended package/version/artifact
  before marking complete. A successful dispatch is insufficient.

Historical limitations about live Ploi behavior, deployed Cloudflare CPU/
subrequest enforcement and the live GETQUICK GraphQL schema remain disclosed;
do not claim the extraction proves them or silently widen this cut to fix them.
Retain existing supported runtime requirements and record the tested
Node/PHP/WordPress/Astro/Alchemy/Bedrock versions with each proof.

## Release contract and execution order

1. Extract once, recording source provenance and assertion allocation; implement
   the boundaries above without unrelated behavior changes.
2. Pass package checks, PHP/WordPress and clean-consumer proofs. Build the two
   release artifacts once and retain the exact validated bytes for publication.
3. Verify tag, both package versions, plugin metadata and CLI version agree.
   Record an immutable release manifest containing schema version, shared
   version, tag/source commit, ZIP/tarball filenames and SHA-256 checksums,
   plus npm's SHA-512 integrity. Do not assume rebuilding yields identical bytes.
4. Upload `gq-content-0.1.0.zip`, the npm tarball and release manifest to the
   tagged GitHub release; publish that exact public npm tarball and request the
   existing Composer registry's `plugin_updated` rebuild. Protect publishing
   credentials; external publication/check tasks must not use stale cached results.
5. Verify registry-visible metadata and artifact identity. Retries resume missing
   stages, verify existing tag/artifact/integrity, and fail on mismatch. Never
   overwrite a published version. Partial availability is reported as partial,
   blocks the Blueprint switch and is not a successful paired release.
6. Declare the pair released only after every proof/release gate passes. Hand
   off its exact versions, configuration, exports, migration resolution,
   runtime readiness interfaces and ADR source mapping to the Blueprint work.

## External gates and downstream hand-off

Implementation can start before these external prerequisites are satisfied;
release completion cannot. Do not introduce circular #1/#2 dependencies.

- [gq-design #12](https://github.com/Quick-Release/gq-design/issues/12): published
  contract fixture version and **gq-content CI** read access, not only Ekis or
  gq-site access. Its proposed 0.4.0 is not assumed available. Gate P5 on actual
  publication/access; never report it passed with local source substitutes.
- `Quick-Release/getquick-registry`: enroll `getquick/gq-content` through
  `release-packages.json` with the ZIP naming convention and grant registry
  repository read access. This is an owner hand-off requirement, not a change
  to make from this repository/session.
- [gq-site #77](https://github.com/Quick-Release/gq-site/issues/77) already owns
  runtime pins, route wiring, migrations and ADR hand-off. Name the additional
  downstream execution scope from #2: **“Content skeleton: import the HTML
  helpers and WPGraphQL client from @getquick/content.”** Do not file it or
  modify gq-site here. Reconcile the two wiring scopes in their owning session.

The package release precedes the coordinated Blueprint switch: the Blueprint
must consume a verified installable pair and retain runtime code until that
switch. Only newly generated Sites import the package. Existing generated
Sites retain their copied helpers; changing them is not authorized by this cut.

`content-api.php`, Site pages/layout/copy/CSS, Astro presentation, manifest
loading, Cloudflare discovery and provisioning stay outside the extraction.
No REST migration, contract-node adapter, React/shared commerce renderer,
existing-Site migration or deployment is included.
