# Issue #6 implementation evidence

Scope: [Publish, refresh and withdraw content across the package pair](https://github.com/Quick-Release/gq-content/issues/6).
Base: `f78f672070d6a8543c9ba3dfd53b5d3f160af0c6`, on main. Recorded 2026-10-18.
Independent Standards/Spec review and eventual push/publication belong to the
parent. No issue edits, closure, push, publication or delegated review occurred.

## Contract and provenance

Read #6 and parent #1 in full through `gh issue view ... --repo
Quick-Release/gq-content --json number,title,body,comments` (both have no
comments), AGENTS.md, tracker/domain guidance, local/shared glossaries,
accepted runtime/package ADRs, the accepted extraction spec and #3–#5 evidence.
Used the requested implement and TDD skills, including tests.md/mocking.md,
at the pre-approved standard Request/Response handlers, public delivery and
installed real CMS-to-package transport seams. The parent explicitly owns
independent review, overriding implement's duplicate review step.
Workers skill/reference guidance informed the local workerd fixture; reviewed
Cloudflare's [Web Crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
and used the existing pinned Alchemy/provider types and compatibility date.
No Wrangler CLI, SDK agent, remote Cloudflare resource or credential was needed.

`git -C /data/code/getquick/gq-site ls-remote origin refs/heads/main` still
resolves to `497a3ae11b5d15df3619f71ff24f095d9b5e8cbe`. The #5 delta review
identified only unrelated CI/Composer changes. This slice additionally checks
all 13 relevant event, refresh, store, delivery, CMS publication, test and smoke
paths against that upstream: no changes from the accepted
`eaec13488d57b3d04059309b5b36de5d016f3de1` checkpoint. That checkpoint remains
the extraction source. No source repository writes or source-history import.
[provenance.json](provenance.json) records immutable Git blobs and SHA-256s.

`node scripts/protocol-evidence.mjs /data/code/getquick/gq-site` verifies the
upstream identity/diff and regenerates the [assertion overlay](assertion-allocation.json):
488 source assertion spans across the affected suites/smokes. It preserves the
#3/#4/#5 inventories and names projections and remaining owners explicitly.
Protocol route wrappers are extracted into standard package handlers; source
application tests now exercise those wrappers at that boundary.

## Implementation

The runtime adds `handleEvent(request, {siteOrigin?}?)` and
`handleRefresh(request, {siteOrigin?}?)`, both `Promise<Response>`. Public
exports/declarations expose no storage, authority, ordering, signature or
budget internals. There are no Astro/Site imports or environment globals.
Each handler checks the method, then the configured server guard before
bindings or CMS transport; binding/transport configuration stays in closures.
Each operation loads fresh bindings. Existing #4 public delivery methods retain
their guarded behavior and #3's credential checks remain active on CMS reads.

The event handler retains source validation order: authority, declared/actual
16 KiB body size, current HMAC-SHA256 signature (five-minute window), JSON,
Site, action, strict schema, then occurredAt relative to signing time. Only
then can it read the CMS or mutate the store. The refresh handler retains
store/token authority, constant-time bearer verification, JSON/object/unknown
field checks, 1–100 path validation and language-home rejection before reads.
Status/body shapes, no-store responses, 405/Allow and the refresh bearer
challenge come from the source wrappers. Missing/short secrets disable only
the corresponding handler; stored public reads remain usable.

Restored private source helpers cover explicit whole/targeted refresh,
conditional promotion, event identities, retries/duplicates, ordering,
withdrawal, lifting withdrawal and signed check state. Withdrawal atomically
marks all entry routes, including moved aliases, without CMS reads. An active
withdrawal prevents cold lookups, targeted/whole refreshes and in-flight reads
from restoring the entry. A later publication can lift it; failed publication
refreshes leave routes hidden until a successful retry. Source equality and
move semantics are retained. The existing #4 store guard continues to discard
raw database errors rather than expose their possible credentials.

Source settings/check dispatch remains coherent, including the protection
against settings refresh lifting a withdrawn home. Broader settings/language
proofs remain #7. Reconciliation execution and lease writers were not added:
a valid signed reconcile request is validated with the accepted source schema,
then returns 503 / `status: failed` with the source `failure` report shape,
changing nothing. This explicit incomplete
state is documented and tested; it never falsely acknowledges reconciliation.
Issue #9 replaces that failure with the actual implementation. No new event
schema or action was introduced. Retry scheduling remains #8.

## Tests and proofs

Narrow red/green commands were `vp test frontend/tests/protocol.test.ts`,
`vp pack`, and the same focused test: initially failed on absent public
handlers, then passed on standard method responses. The next signed-withdrawal
case failed with 405 before the private event/store/refresh extraction, then
passed. Existing #4's secret-safe failure test caught the raw source guard
regression and passed after retaining its sanitizer. Focused event/withdrawal,
refresh and protocol suites, `vp check`, and `vp exec tsc --noEmit` ran during
implementation. Test migration errors (Site redirect wrapping and a missing
refresh test helper) were corrected in tests rather than altering source
runtime semantics.

Final command: `vp run validate`, with every proof/external-effect task uncached.
[validation.log](validation.log) retains the complete output. It includes:

- 222 package tests: all prior 101 plus 39 event, 32 withdrawal, 15 refresh
  and 35 protocol cases. The same 222 cases run in a clean packed/installed
  consumer without private registry credentials. Public declarations also
  typecheck the standard handler signatures without Node ambient types.
- Vite+ Pack, formatting, lint/type checks and final TypeScript noEmit.
  The consumer inspects the artifact allowlist, public declarations and
  runtime import graph for private/Site/framework/Node migration leakage.
- The original real Alchemy P1 migration/update lifecycle, extended with
  HMAC publication/withdrawal, public delivery, duplicate ordering after
  Worker update, targeted-refresh withdrawal protection and later
  republication under actual local workerd/D1. All five migration identities,
  shared publication data and the withdrawn entry persist across the update.
- A fresh original P2 Composer/Bedrock/WordPress/WP-CLI run, retaining its 110
  checks, followed by the new installed pair proof below.

`vp run pair` builds first, installs the current CMS ZIP through the fresh P2
harness, then runs `python3 scripts/pair-proof.py`. That script packs the current
Frontend with `vp pm pack`, installs it using `vp install` with declared pnpm,
and starts an actual HTTP consumer of its standard handler and publication
store. Actual installed WordPress saves/updates use its real HTTP transport;
no PHP CMS stubs or replaced sender/loader are involved. The GraphQL boundary
returns explicit fixtures; the Frontend never accepts page content from events.

The 18 pair checks prove configured Unicode/non-slug Site identity and actual
PHP HMAC compatibility, source post-meta record/wire keys and WPGraphQL node
identity, publication, update with a fresh identity, real permalink move and
previousUri retention, durable reads through a CMS outage, same-identity retry
without another CMS read, immediate withdrawal at both stored routes, later
republication, password withdrawal/removal, permanent deletion and cleanup of
the delivered deleted-entry record. A Site-owned HTTP debug observer records
only the timeout value: actual publication transport defaults to 15 seconds,
and the supported filter receives 15 and controls the integer timeout (7).
This observes options on real HTTP sends; it does not claim to measure a
PHP-FPM response deadline. Proof files, fixtures, stores and observers remain
outside both release artifacts.

## Versions and limits

Tested Node 24.21.0; global vp 0.3.0; project Vite+ 1.1.0, Vite 8.3.3,
Rolldown 1.2.12, Vitest 5.0.3, Oxfmt 0.72.0, Oxlint 1.87.0;
pnpm 12.11.2; TypeScript 6.0.3. The unchanged fixture lockfile pins
Alchemy/cloudflare-runtime 2.0.0-beta.79 and workerd 1.20260901.1, with the
existing supported compatibility date 2026-09-08. PHP 8.5.10, Composer 2.10.3,
Bedrock 1.31.7, WordPress 7.1.3, WP-CLI 2.12.0,
roots/bedrock-autoloader 1.1.0, composer/installers 2.3.0 and SQLite Database
Integration 3.1.0. The validation log prints installed PHP package versions.
No Astro consumer was built: Site page rendering is outside this package.

This completes #6's P2/P6 publication/protocol slice, not the broader P2/P6
release gates. The actual CMS transport uses Node SQLite; local workerd/D1 is
proved separately through the installed package/Alchemy fixture. It is not a
live CMS-to-Cloudflare deployment. Full WordPress GraphQL schema, multilingual
CMS/cron integration, settings, scheduler and reconciliation proofs remain
#7–#9/#11. Site document composition, public GET redirect/header wrapping,
copy, metadata and CSS remain gq-site #77. Node database-reopen cases do not
claim a Worker restart; the Alchemy update proof provides that runtime evidence.
No live Ploi/PHP-FPM, deployed CPU/subrequest limits, Blueprint switch, registry
or publication is claimed. There are no issue #6 implementation blockers.
