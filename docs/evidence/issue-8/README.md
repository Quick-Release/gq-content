# Issue #8 implementation evidence

Scope: [Recover failed deliveries through the CMS scheduler](https://github.com/Quick-Release/gq-content/issues/8).
Base: `b931ee5f1c3a4b57ab3aaf2f79a287b793bf0dd0`, on main, 2026-10-18.
The parent owns independent Standards/Spec review and eventual push/release.
No issue edits/closure, push, publication, live Site changes or delegated review.

## Independent review correction

Standards review found no issues. Spec review found that the initial Worker-update
proof could also pass if its failed event record disappeared before retry. The
proof now captures the complete failed row, checks it is identical after the
Worker update before any retry, then verifies recovery retains its identity and
receipt timestamp while advancing attempts from one to two and clearing failure
details. A duplicate must leave that recovered row unchanged. Raw-row inspection
is confined to this disposable migration/persistence consumer; no production
endpoint or public export was added. The new assertions failed before the
consumer exposed diagnostic event rows, then passed through the actual Alchemy
lifecycle. See [review-validation.log](review-validation.log) for the corrected
proof and [review-red.log](review-red.log) for its initial failure.

## Contract and provenance

Read #8 and parent #1 bodies/comments using `gh --repo Quick-Release/gq-content`
(both have no comments), AGENTS.md, tracker/domain guidance, local/shared
glossaries, accepted ADRs/spec and #3–#7 evidence. Applied implement and TDD,
including tests.md/mocking.md, at the user-approved real installed CMS/CLI,
server-cron invocation, package handler/public-delivery and delivery-filter
callback boundaries. The parent explicitly owns the independent review.

[provenance.json](provenance.json) records the accepted gq-site checkpoint
`eaec13488d57b3d04059309b5b36de5d016f3de1`, the freshly observed upstream
`497a3ae11b5d15df3619f71ff24f095d9b5e8cbe`, source blobs and SHA-256s.
Explicit relevant delta verification covers 13 module/runtime/retry/smoke/ADR
paths: unchanged. The newer upstream commit remains the unrelated previously
reviewed CI/Composer policy, fixtures and release/development documentation.
No source checkout writes or extraction from current HEAD.

Run `node scripts/retry-evidence.mjs /data/code/getquick/gq-site` to recheck it.
[assertion-allocation.json](assertion-allocation.json) overlays 114 source
assertion spans, preserving prior inventories. Runtime retry assertions move to
public DTO/handler outcomes and real WordPress/CLI. Astro document composition
stays gq-site #77; lost-event reconciliation stays #9 and broader daemon proof
stays #11. Database outcome side channels become durable duplicate/recovery
behavior at the public interface. No pending allocation is called completed.

## Implementation and focused checks

The #5 production extraction already contains the required scheduler, records,
backoff, superseding guards and diagnostics. This slice exercises that installed
code rather than refactoring it. Production PHP/Frontend source, event schemas,
record keys, supported page/post types and public extension APIs remain intact.

Five migrated Frontend cases in `frontend/tests/retries.test.ts` prove:
publication recovery hours later, shared-setting recovery on home and entry,
recovery after interrupted outcome persistence and store reopen, newer events
superseding older retries without CMS reads, and old-signature refusal with
fresh-signature acceptance. The interrupted outcome uses a real SQLite trigger
that rejects the external database write, then removes it and reopens the same
store; no runtime collaborator is mocked. Tests import public package entries.

Focused suite and quality/type checks passed during implementation. These are
regression proofs over already-extracted behavior, not claimed new production
red/green fixes. Initial installed-proof failures exposed harness prerequisites:
P2 must recreate the installation after Polylang; the earlier pair ends with CMS
reads offline; P2 deliberately leaves failed configuration records; and WP-CLI
`--quiet` suppresses success logs but retains due-row table output. The harness
now controls those prerequisites through real WordPress APIs and the GraphQL
boundary, preserving source output. No PHP function, CLI command, scheduler,
lease, transport or framework API is replaced by a mock.

## P2/P6 installed scheduler proof

`vp run retry` builds/installs the current Composer ZIP through real
composer/installers and Bedrock, builds/packs/installs the public npm package
using `vp pm pack` / `vp install` (pnpm 12.11.2), runs the prior #6 pair, then the
retry extension. It is uncached and precedes the retained #7 multilingual proof
in `vp run verification`. To iterate against a freshly prepared P2 installation,
`python3 scripts/pair-proof.py --retries` runs the pair and retry portion.

The HTTP receiver delegates actual WordPress requests to the installed public
package handlers and public reads against persistent Node SQLite. GraphQL
answers/outages are the external boundary fixture. The allowed `gq_events_now`
filter advances retry due times; signatures, attempts, lease and send-budget
clocks remain real. [retry-records.json](retry-records.json) retains sample
persisted envelopes/outcomes, callback-owned records and real budget evidence.
It contains no credentials or signature material.

Assertions cover:

- Production invalid endpoint retains a correctly identified failed record;
  restoring configuration lets the scheduler deliver that same event.
- A successful WordPress save with failed CMS read-back leaves last-known-good
  public content, retained failed delivery, and an authorized editor REST report
  saying it is saved but not delivered. Unauthorized access is refused.
- Early runs send nothing. Real failed retries preserve event identity and
  attempts through CLI processes; delays follow 60/120/300/600/1800/3600 seconds,
  repeat hourly and stop automatically after twelve attempts. Operator retry
  recovers the same event at attempt thirteen. Site Health reports exhausted
  delivery critically; reports exclude the signing secret.
- A fresh failed save recovers automatically with no new save. Captured wire
  envelopes have the same event and different real timestamp/HMAC signature.
  Only the comparison result is retained, not signatures.
- A real WP-CLI save process is killed after WordPress hooks persist its new
  pending identity and before shutdown sends it. The record survives the first
  119 seconds, then the scheduler sends it at 120 seconds and the new content
  reaches package public delivery. This is a killed CLI process, not a PHP-FPM
  timing proof. A newer real save replaces failed scheduled work.
- A real settings save retains a failed identity event and recovers it through
  the scheduler. Its new description is read from WordPress into the GraphQL
  fixture; public home reads retain the old value during failure and show the
  saved value after cron invocation. A permanent post deletion succeeds during transport failure,
  retains its withdrawal in `gq_publication_events_deleted` after the post/meta
  are gone, then cron invocation withdraws public delivery and removes the
  confirmed deleted-entry record across separate real commands.
- The supported delivery filter appends rows with subject, label, event,
  delivery, callback and both present/absent optional post. Each callback gets
  its exact event, sends a real signed existing `check` event using WordPress
  HTTP, persists its own outcome and returns it. There is no new event schema
  or post type. Successful callback records are not sent again.
- Three due extension rows each take 23 real seconds before HTTP delivery.
  Two callbacks complete; the third is deferred by the actual 45-second send
  budget, then completes next run. A second actual WP-CLI process, launched
  while the first callback is sleeping, reports another run and sends nothing.
  An expired persisted lease is recovered on a later command. The proof checks
  observed sends, persisted callback outcomes and deferred scheduler output,
  not just delay arithmetic or a manually pre-populated active lock.

The server-cron proof uses a disposable executable `wp` launcher pointing to
the downloaded pinned WP-CLI, a minimal explicit environment and real Bedrock
working directory. `/bin/sh -c 'wp gq-events retry-due --quiet'` actually runs
and changes package public delivery without a visit or republish. It proves
command invocation, not daemon timing, Ploi user/environment provisioning or
crontab installation. Quiet retains table columns when events are sent and
suppresses success messages; JSON/table/delays output remains unchanged.
No WP-Cron event is scheduled as the delivery mechanism.

Before isolating retries with `gq_events_reconcile => false`, the proof calls
real `wp gq-events reconcile` against this package and asserts failure. The
Frontend's documented unavailable reconciliation remains 503 until #9. Retry
success never stands in for reconciliation completion.

## P1/P6 workerd and validation

The Workers best-practices skill/runtime reference informed the small fixture
extension, retaining pinned provider types and compatibility settings. Reviewed
Cloudflare's [Web Crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
No new runtime API, Wrangler command, remote resource or credential is required.

The installed Alchemy/workerd consumer fails a signed settings event at its
GraphQL boundary, updates the Worker while retaining the same D1 database,
then retries the same identity. Public language-home design changes from the
first revision's `#0a0` to the second revision's `#00a`, and another retry is a
durable duplicate. All previous migration identities, publication bytes,
language results, withdrawal protection and later republication checks remain.
The fixture's GraphQL response changes with its revision; it is not a live CMS.

The proof writes its records under `.proofs/pair`; the successful run is copied
here explicitly so running tests does not edit tracked evidence. Validation
logs and exact artifact hashes are retained beside this document.
The final full run covers 273 local tests and the same 273 clean installed
consumer tests, formatting/lint/types, declaration/artifact checks, real P1
Alchemy lifecycle, fresh P2 Composer/Bedrock install, prior pair, scheduler and
real Polylang pair. A subsequent focused workerd run verifies the public design
change assertion added to the initial full-run fixture. The final focused run in [final-retry-validation.log](final-retry-validation.log)
verifies the disposable record-output path, the stronger killed-CMS-save pending
case and the actual saved-description public read. The earlier full run used
a seeded pending record and checked settings delivery outcomes. Final
formatting/types are rerun after evidence generation.

Versions: Node 24.21.0, pnpm 12.11.2, Vite+ 1.1.0 / Vitest 5.0.3,
TypeScript 6.0.3; PHP 8.5.10, Composer 2.10.3, WP-CLI 2.12.0,
WordPress 7.1.3, Bedrock 1.31.7, composer/installers 2.3.0,
roots/bedrock-autoloader 1.1.0, SQLite integration 3.1.0, Polylang 3.8.11;
Alchemy/cloudflare-runtime 2.0.0-beta.79, Effect/platform-node/shared
4.0.0-rc.115 and compatibility date 2026-09-08. The pinned runtime rejects a
newer date, as already documented in #4. No Astro rendering is executed in this
package proof; the source presentation projection stays Blueprint-owned.

## Limits

No cron daemon or Ploi provisioning, PHP-FPM response timing, live GETQUICK
GraphQL schema, deployed Cloudflare CPU/subrequest enforcement, registry
availability or release recovery is claimed. Local WordPress uses the public
SQLite integration rather than a MySQL matrix. Callback code must return;
the budget bounds starting subsequent sends, not forcibly cancelling arbitrary
third-party callbacks. Reconciliation completion remains #9, published contract
fixtures #10, broader daemon/pair integration #11 and release work #12–#13.
These are remaining parent gates, not #8 blockers.
