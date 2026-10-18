# Issue #4 implementation evidence

Scope: [Serve durable publications through the installed package](https://github.com/Quick-Release/gq-content/issues/4).
Base: `c899d6f0af26ba3f253b61419390912972f3babe`. Recorded 2026-10-18.
The parent owns independent Standards/Spec review and the eventual push/release.
No issue edits, publication, push or duplicate delegated review were performed.

## Source and adaptations

Read #4 and its comments, parent #1 and its comments, completed #3 and its
review evidence, AGENTS.md, domain/issue-tracker instructions, local/shared
glossaries, accepted ADRs and the extraction spec. Applied implement and TDD
skills at the already approved public delivery, installed migration/consumer
and real pinned Alchemy lifecycle seams. Workers and Wrangler skills informed
the local runtime proof; no Wrangler command substitutes for Alchemy here.

`git -C /data/code/getquick/gq-site fetch origin main` resolved upstream to
`eaec13488d57b3d04059309b5b36de5d016f3de1`; the relevant Frontend, migration,
smoke and ADR path diff was empty. No new checkpoint or source delta was taken.
[provenance.json](provenance.json) records 13 source files with original Git
blobs and SHA-256s. `node scripts/delivery-evidence.mjs /data/code/getquick/gq-site`
verifies the relevant upstream diff and every SQL file's original bytes/name.
All five migrations are shipped directly in `frontend/migrations/`.

The private publication store extracts only read, promotion, superseding, keys,
states and attempt recording needed by delivery (event/reconciliation mutation
APIs remain for their owning later slices). Delivery closes over the configured
client and canonical language array; it imports no framework, global Site,
environment or binding discovery. Public page/result and structural database
types from #3 remain the contract; storage internals are absent from exports.

The runtime adds `publishedHome(siteOrigin?, language?)`,
`publishedEntry(path, siteOrigin?)` and `pageChrome(siteOrigin?)`. It preserves
last-known-good data without an age limit, format/body validation, shared design
overrides, confirmed missing/unavailable, cold lookup, route moves, language
isolation, legacy default-language entries, canonical alternates and conditional
promotion/withdrawal protection. Partial cold reads retain the source behavior:
serve available HTML without persisting an incomplete publication, then retry
and recover on a later visit. Stored reads need neither refresh/event secrets
nor CMS access. Bound-store errors never activate live fallback.

Explicit contract adaptations: all delivery methods guard server context before
bindings/transport; production pageChrome without a store returns null, and only
`development: true` permits any storeless live delivery. Binding exceptions
return safe failures. Store diagnostics discard raw binding errors in public
messages/logs because those errors can contain credentials. Passing an equivalent
home language reuses the instance's canonical language object. These changes
were tested at the package boundary, including failing tests before fixes.

## Assertion allocation

[assertion-allocation.json](assertion-allocation.json) overlays the immutable
[#3 inventory](../issue-3/assertion-allocation.json), identifying public-read DTO
projections and remaining protocol/presentation responsibilities for homepage,
entries, routes and languages. It does not claim copied HTML assertion syntax.
The 40 delivery tests cover the public-read behaviors plus access, freshness,
malformed-state, ordering, withdrawal-protection and migration-consumer cases.
Private SQLite and WordPress stub support are under tests only and import the
public package/installed migration export. Refresh preparation, refresh/event
HTTP contracts and mutation assertions remain #6/#7/#9. Presentation, metadata,
copy, CSS and Astro wiring remain gq-site #77; real CMS/multilingual smoke remains
#11. These pending proofs are not reported as completed by this slice.

`node scripts/assertion-inventory.mjs /data/code/getquick/gq-site` passed again:
all six #3 suites retain all 139 original assertion expressions, across the
unchanged inventory of 26 source files / 1,011 assertions. #3 evidence was
preserved. Its 61 tests continue to run alongside 40 delivery cases.

## P1: installed Alchemy lifecycle

Run `vp run alchemy` (or `vp pack` then `node scripts/alchemy-consumer.mjs`). It
creates a disposable consumer under this repository's ignored `.proofs/`, packs
with `pnpm pack`, installs using `pnpm install --frozen-lockfile --ignore-scripts`,
typechecks the Worker against installed declarations and runs `node proof.mjs`.
User/global npm configs are replaced with public-only configuration and auth,
Cloudflare and Alchemy environment values are removed. No credential or remote
resource is needed. The fixture's lockfile pins the Alchemy test graph; only the
fresh local tarball's SHA-512 integrity is inserted before frozen installation.

This uses **Alchemy 2.0.0-beta.79**, the source project's exact pin, and its real
local D1 and Worker providers through Alchemy's `Test/Core` lifecycle harness
(`dev: true`, `sidecar: false`). The account identity is a local dummy; credentials
are unused. The providers, executor, migration pipeline, planner and state are
not replaced. The installed absolute `migrationsDirectory` goes directly into
`Database(..., { migrations: migrationsDirectory })`, then the database resource
is bound to the Worker. No SQL is copied into a Site or consumer migrations folder.

The first lifecycle applies 0001–0005 through Alchemy's workerd D1 gateway.
Before seeding, the package-consuming Worker confirms all five ledger names and
hashes, every application table and unavailable delivery from its empty store.
A test-only consumer action seeds home/chrome; public `publishedHome` serves
those rows with a deliberately unusable CMS transport and no event/refresh secrets.

The second lifecycle changes the Worker's revision binding. Alchemy reports
`[Publications] noop (local)` and `[Frontend] update (local)`. The proof compares
identical database IDs, all five output hashes, complete ledger rows (including
IDs, names, hashes and applied timestamps), raw publication rows, table lists and
public delivery results. The changed response revision proves the updated Worker
handled the second read. Destruction runs through the local lifecycle afterward.
The [validation log](validation.log) retains the full ledger and data evidence.

Local prerequisite issues were resolved without widening scope: installing the
Effect Node platform peer also requires its shared package at the matching
4.0.0-rc.115 version (otherwise its permissive range selects incompatible stable
4.0.5). The fixture explicitly pins that override. Today's compatibility date
was rejected by beta.79's bundled binary with: `This Worker requires compatibility
date "2026-10-18", but the newest date supported by this server binary is
"2026-09-08".` The proof therefore uses supported `2026-09-08`, without upgrading
Alchemy. The local provider selects another port during Worker replacement;
requests use the returned URL. This is the in-process local production lifecycle,
not a claim that the separate RPC-sidecar topology or a cloud deploy was tested.

## Final validation

`vp run validate` passed uncached, including:

- Compiled ESM and declarations for root, server and infra-only migrations.
- Formatting, type-aware lint/type checking, and `vp exec tsc --noEmit`.
- Eight suites / **101 tests locally**, then the same **101 tests in a clean
  pnpm-installed consumer**, preserving #3 access/client/helper tests.
- P3/P4 artifact inspection of **15 files**, exact public export keys, public-only
  dependencies, declarations without Node ambient types or validation types,
  real HTTP client integration, and no Site/framework/private imports or fixtures.
- Root/server/runtime chunks exclude Node imports and migrationsDirectory;
  the sole Node entry is migrations.js. The actual Alchemy-built Worker imports
  the installed server entry and runs without nodejs_compat.
- The mandatory P1 lifecycle above, including installed Worker typechecking,
  exact SQL identities and update persistence. No SQLite-only or Wrangler-only
  result is presented as P1.

Focused commands during implementation: `vp pack`,
`vp test frontend/tests/delivery.test.ts`, `vp exec tsc --noEmit`, `vp check`,
`node scripts/alchemy-consumer.mjs`; final command/results are in validation.log.
Toolchain: Node 24.21.0, pnpm 12.11.2, TypeScript 6.0.3, Vite+ 1.1.0
(Vite 8.3.3 / Vitest 5.0.3), Alchemy and cloudflare-runtime 2.0.0-beta.79,
Effect/platform-node/platform-node-shared 4.0.0-rc.115. The pinned dependency
ledger is in `scripts/fixtures/alchemy-p1/pnpm-lock.yaml`. Existing Vite+ peer
alias/deprecated transitive warnings remain as disclosed in #3 evidence.

There is no #4 blocker or migration hand-off decision needed. This proves the
#4 delivery/migration slice, not the complete paired-release gates. CMS/PHP,
WordPress/cron, Astro rendering, RPC sidecar, live Ploi, live GraphQL schema and
deployed Cloudflare CPU/subrequest enforcement were not tested here.
