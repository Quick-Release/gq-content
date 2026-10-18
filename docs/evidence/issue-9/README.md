# Issue #9 implementation evidence

Scope: [Reconcile missed changes and expose readiness evidence](https://github.com/Quick-Release/gq-content/issues/9).
Base: `0c939635e27e40cbb6fb47565f270461ee03adfe`, main, 2026-10-18.
The parent owns independent Standards/Spec review and eventual push/publication.
No issue edits, closures, parent changes, push, publication or #10+ work.

## Contract and provenance

Read full #9 and parent #1 bodies/comments through `gh --repo Quick-Release/gq-content`
(both had no comments), AGENTS/tracker/domain guidance, local/shared glossaries,
accepted ADRs/spec and prior evidence. Applied implement, TDD with tests.md and
mocking.md, and Workers guidance. The user preapproved signed handler/delivery/
readiness responses, actual installed WordPress CLI/scheduler→workerd and the
supported reconciliation filter. Independent review remains with the parent;
no duplicate review delegation.

[provenance.json](provenance.json) records the accepted extraction checkpoint
`eaec13488d57b3d04059309b5b36de5d016f3de1` and freshly observed upstream
`497a3ae11b5d15df3619f71ff24f095d9b5e8cbe`, with source blobs/SHA-256s for
18 runtime, reconciliation, readiness, multilingual, smoke and ADR paths.
Every one is unchanged. The broader relevant directory review found only two
added CI Composer smoke scripts; both concern installer behavior in a generated
CI image, with no runtime/reconciliation/readiness changes. Source working paths
match upstream. The source repository was read only; extraction remains from
the accepted checkpoint.

Recheck with `node scripts/reconciliation-evidence.mjs /data/code/getquick/gq-site`.
[assertion-allocation.json](assertion-allocation.json) overlays 265 immutable
source assertion spans. Reconciliation runtime assertions move from Astro/SQL
side channels to public handler reports and delivery DTOs. Shared-language
reconciliation and readiness evidence are allocated explicitly. Site markup,
`gq site check` orchestration, real GETQUICK schema validation, independent media,
provisioning and cron daemon installation stay Blueprint-owned or in the later
release regression gate. No disjoint Node/workerd pair is presented as the new
integrated criterion.

## Implementation

Restored private source reconciliation and store/index/lease helpers, adapting
module-global dependencies to each configured runtime's client and canonical
languages. The signed dispatcher now runs reconciliation instead of #6's
intentional unavailable response. Event validation order/schema, status/wire
bodies and no-store headers remain unchanged: 200 for reconciled/behind/busy,
503 for failed. Signed check uses the accepted bounded store and reconciliation
evidence; no orchestration or public storage methods/exports were added.

Canonical shared comparisons cover every language's home, identity and chrome,
and Site-wide design. Canonical published-list comparisons repair new/changed/
moved/republished/removed content through existing publication ordering and
withdrawal rules. Two rotating stored-entry rereads detect unchanged modification
times. Incomplete lists remove nothing; failed reads retain last-known-good
content. Source request reservations, oldest-attempted continuation, D1 lease
ownership, outcome counts/failures and last-matched time are preserved. The five
migrations, public configuration, server guards, fresh bindings and isolation
remain intact. CMS production code and CLI/output/filter contracts are unchanged.

The first narrow test failed at the signed 503 response, then passed after
restoring the private source implementation: [red-publication.log](red-publication.log),
[green-publication.log](green-publication.log). Subsequent source characterizations
exercise the restored behavior at the approved package seam. No internal runtime
module/collaborator is mocked. GraphQL answers/outages and controlled time are
system-boundary fixtures; the interrupted lease test uses an actual SQLite
trigger refusing the completion write.

The old pre-#9 unavailable assertion was replaced with real reconciliation
coverage. The retry proof now expects a successful explicit reconciliation,
then disables reconciliation using the supported boolean filter for retry-only
isolation. All earlier recovery assertions, including the corrected complete
failed event row/attempt progression proof from #8, remain.

## P2/P6 integrated installed proof

`vp run reconciliation` is uncached and depends on the retained multilingual→
retry→pair→fresh P2 installation chain. It packs/installs the npm artifact using
`vp pm pack` / `vp install` with pnpm 12.11.2. The real pinned Alchemy providers
apply the installed migrations to local D1 before starting a workerd consumer
of the installed package. No Cloudflare credential or remote resource is needed.

`reconciliation.mjs` runs a GraphQL boundary HTTP server whose answers come from
`cms/tests/reconciliation-export.php`: snapshots of the actual Composer/Bedrock
WordPress/Polylang database after real WP-CLI operations. It does not fabricate
CMS language functions, hooks, signing, transport, scheduler or CLI responses.
Only GraphQL answers, partial-list/failure responses and delays are fixtures.
Actual CMS HTTP requests enter workerd's public package handlers directly.

The three lifecycle phases prove:

- Forty real bilingual entries, omitted delivery events and actual modification
  times. Default-enabled reconciliation prepares both languages; false filter
  performs no run and retains the exact source CLI configuration error.
- Real CLI partial output and pending counts 23→6→0 across scheduler runs, with
  each measured GraphQL run within 40 requests and all forty stored public reads
  matching real CMS content.
- A delayed external read holds the real D1 lease; a simultaneous signed run
  returns busy. The retained #8 proof separately runs concurrent actual CMS CLI
  scheduler processes and checks its scheduler lock and wall-clock send budget.
- A change made without save hooks creates a failed synthetic publication when
  its CMS read fails. A full CMS read outage retains both language homes, the
  last matched time and failed evidence. Real Site Health and CLI delays report
  the stale reconciliation without secret material.
- Worker updates preserve the **complete pending and complete failed
  reconciliation rows before any continuation/recovery**. Full event rows,
  refresh attempts and migration identities are also compared before retry.
  Recovery keeps synthetic event/envelope/receipt identity, advances attempts
  from one to two, clears failure details and restores public delivery.
- Actual WordPress publication hooks/signatures/HTTP still reach workerd. A lost
  language-route move redirects, an incomplete list cannot remove an entry,
  complete confirmation removes it, and an English home repair leaves the
  Portuguese page intact. Signed check exposes only the accepted evidence.

Raw D1 diagnostics exist only in the disposable test consumer, solely for
migration/persistence comparisons. Core assertions use public handlers/reads.
No production diagnostic endpoint or storage API was introduced.

## Validation

`vp run verification` passed all eleven tasks with zero cache hits. All 289
local tests and 289 clean installed consumer tests passed. This retains the
prior 273-test baseline except the deliberately obsolete unavailable-reconcile
assertion, replaced by the implemented behavior; seventeen additional test cases
bring the total to 289. Final assertion refinements for absolute unchanged URIs
and missed English entry updates passed focused tests and repeated local/clean
installed suites. Formatting, lint, type checking, PHP syntax and Composer
validation passed.

[validation.log](validation.log) contains the full P1/P2/pair/retry/multilingual
and integrated run. [final-unit.log](final-unit.log) and
[final-installed.log](final-installed.log) retain the final 289-test runs;
[focused.log](focused.log) contains 63 reconciliation/language cases.
[persistence.json](persistence.json) retains complete before/after pending and
failed rows, event identities/attempts and migration ledger comparisons.
[partial-cli.txt](partial-cli.txt), [failed-cli.txt](failed-cli.txt),
[final-check.json](final-check.json) and
[cms-reconciliation.json](cms-reconciliation.json) retain actual bounded runtime
and CMS output. [tested-artifacts.json](tested-artifacts.json) records local
proof artifact hashes; these are not published/release artifacts. The full command is `vp run verification`; every task is uncached.
It includes all earlier package suites, formatting/lint/type checks, clean
installed consumer declarations/artifact inspection, P1 migrations/Worker update,
fresh P2 Composer/Bedrock, pair/retry/Polylang and the new integrated proof.
Focused development runs used `vp test frontend/tests/reconciliation.test.ts
frontend/tests/settings-languages.test.ts`, `vp exec tsc --noEmit`, `vp pack`
and `vp check`. PHP syntax and Composer checks are additional checks in P2.

Tested versions: Node 24.21.0; global vp 0.3.0, local Vite+ 1.1.0 (Vite 8.3.3,
Rolldown 1.2.12, Vitest 5.0.3, Oxfmt 0.72.0, Oxlint 1.87.0), pnpm 12.11.2,
TypeScript 6.0.3; Alchemy/cloudflare-runtime 2.0.0-beta.79,
Effect/platform-node/shared 4.0.0-rc.115, workerd 1.20260901.1,
compatibility date 2026-09-08 (the pinned runtime rejects newer dates);
PHP 8.5.10, Composer 2.10.3, Bedrock 1.31.7, WordPress 7.1.3,
WP-CLI 2.12.0, roots/bedrock-autoloader 1.1.0, composer/installers 2.3.0,
SQLite Database Integration 3.1.0 and Polylang 3.8.11.

## Limits

No live Site/registry/Blueprint changes, cron daemon/Ploi provisioning, PHP-FPM
behavior, real GETQUICK GraphQL schema/Polylang GraphQL plugin interoperability,
Polylang Pro extensions, deployed Cloudflare CPU/subrequest enforcement or
release publication/recovery is claimed. Public WordPress/Polylang behavior is
real; GraphQL is the explicit external boundary snapshot. CMS storage uses the
real SQLite integration rather than a MySQL matrix. Source large-list/load and
rotating-reread timing limitations remain: unchanged-time changes on large Sites
are eventual, not a five-minute promise. Full P6 release aggregation remains
#11; P5 and publication gates remain their later issues.
