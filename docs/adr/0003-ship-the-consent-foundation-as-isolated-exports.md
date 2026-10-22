# Ship the consent foundation as isolated exports of the content package

Status: accepted for this provider, 2026-10-22, under the directed execution of
[gq-platform ADR 0008](https://github.com/Quick-Release/gq-platform/blob/claude/cookie-consent-foundation/docs/adr/0008-consent-and-legal-pages.md)
(itself Proposed). Revisit if ADR 0008 is amended or rejected.

ADR 0008 assigns this repository the neutral consent core, its record and read
endpoints, the consent database migrations and purge, the Astro adapter and
default UI, Runtime copy, the shared acceptance suite and the `legal` settings
event, on condition that commerce can import the neutral and server pieces
without the paired Composer plugin, CMS bindings or content runtime.

`@getquick/content` gains six entries, released with the pair under its one
version: `/consent` (categories, catalog, configuration version, cookie,
decisions, records, copy, embed rewriting), `/consent/client` (browser runtime),
`/consent/server` (Worker endpoints and purge), `/consent/migrations`
(Node-only), `/consent/astro` (server-rendered default UI and legal footer, no
Astro import) and `/consent/testing` (acceptance suite over structural
Playwright types). Their import closure contains no content runtime, WordPress
client, publication store, framework or zod; packed-artifact proofs in workerd
and TanStack Start enforce this on every validation.

Consent records live in a separate D1 database (`CONSENT_DB`) with its own
migration directory, so the publication store's "visitor requests never write"
guarantee is unchanged. The content runtime applies consent only when a Site
passes `consent`: embeds are rewritten at the single delivery step (stored rows
stay as published) and gq-config's Legal Contract and GA4 settings are read
into each language's chrome, refreshed by `legal` and `analytics` settings
events. Without that option existing Sites' output is byte-identical.

Considered: a separate `consent` package (ADR 0008 does not preapprove it, and
isolation within this package was achieved); rewriting HTML at ingest (would
tie stored rows to a Site's service set and need republication on every
configuration change); Astro components shipped as `.astro` source (would make
Astro a peer and require consumers to compile package source).
