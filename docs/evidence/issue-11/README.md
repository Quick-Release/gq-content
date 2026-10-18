# Issue #11 installed-package candidate regression

Scope: [Complete installed-package regression proofs](https://github.com/Quick-Release/gq-content/issues/11),
against content base `dcf7e21cbc325223aa2e032b97652a624adc15f1` on main.
This is a local **P1–P4/P6 candidate** record. It does not release the pair,
switch the Blueprint or mark P5/P7 complete. The parent owns independent
Standards/Spec review and the eventual push/publication. No issue or parent
spec was edited, no other owning repository was written, and no release or
registry operation was performed.

## Reproduce

Use the declared Node engine, pinned `pnpm@12.11.2` through Vite+, PHP with
SQLite, Composer, Docker (Linux host networking), Python and Git. The cron
image is pinned by digest in `scripts/cron-proof.py`; Docker can pull that exact
public image if absent. Composer/download caches may retain dependencies;
proof actions, packing, consumers, WordPress installation and Alchemy lifecycles
run anew. No Cloudflare account/token or private npm credentials are needed.

```sh
vp install --frozen-lockfile
node scripts/assertion-inventory.mjs ../gq-site
node scripts/regression-inventory.mjs ../gq-site
vp test frontend/tests/delivery.test.ts
vp run verification
python3 scripts/regression-evidence.py
vp fmt docs/evidence/issue-11
vp check
```

The source checkout is needed only to audit immutable provenance/allocation;
package build, tests and installed consumers have no source-repository
runtime dependency. The inventory command retains historical #3 output;
`git diff` must show no change to its original allocation. The final generator
verifies overlay spans/blobs, all 26 source files, and existence of each exact
runnable destination. `library-preservation.log` independently checks the
six libraries' 139 original assertion expressions and parameter tables.

The full run's Vite+ DAG compiles once, runs quality/unit/installed/Alchemy
checks, creates a fresh Composer/Bedrock/WordPress installation, runs the pair,
retry and Polylang proofs, then runs WordPress CLI against the installed
package in workerd. It ends with TypeScript checking. `vp run reconciliation`
is the focused integrated path; it also rebuilds/reinstalls its prerequisites.
`GQ_PROOF_DISABLE_DAEMON=1 vp run reconciliation` deliberately fails the new
recovery assertion, as recorded in `red.log`; merely executing the prior shell
runner cannot satisfy the daemon proof.

## Proof coverage

- **P1:** `scripts/alchemy-consumer.mjs` packs with `vp pm pack`, installs with
  `vp install --frozen-lockfile`, resolves `@getquick/content/migrations`
  inside node_modules and drives pinned Alchemy's real local D1/Worker
  providers. All five original SQL files are applied before the Worker;
  repeated lifecycle preserves DB identity, complete migration ledger/hashes,
  publication bytes and public delivery without reapplication. The integrated
  proof additionally compares every pending/failed reconciliation record,
  event and refresh attempt before continuation/recovery across Worker updates.
- **P2:** real plugin-root ZIP, composer/installers **2.3.0**, Bedrock
  **1.31.7**, autoloader **1.1.0**, WordPress **7.1.3**, WP-CLI **2.12.0** and
  host PHP **8.5.10**. Loading once/in dependency order, configured identities
  including non-slug strings, constant precedence/invalid constants, endpoint
  precedence, missing/invalid configuration, saves, publication/settings,
  retry/reconcile/quiet commands, Site Health and bare/JSON versions are checked.
  Module source bytes are compared against the ZIP after actual Composer install.
- **P3/P4:** all **296** public tests run both locally and against a newly
  packed, installed consumer. The previous 293 cases remain; three added cases
  directly cover development's unavailable chrome with an optional absent
  post image/date, and missing/unavailable development homes. Public declarations
  typecheck without Node ambient types. The clean consumer uses public-only
  user/global npm configuration and removes token/auth environment variables.
  Artifact inspection rejects fixtures/tests/private dependencies/types, Site
  assumptions and Node/migration imports in browser/server chunks. Access
  covers browser-before-binding guards, paired credentials, HTTPS/origin/path/
  userinfo restrictions, manual redirects, secret-safe errors, fresh bindings,
  isolated instances and canonical language object identity.
- **P6:** actual WordPress saves and CLI enter public installed handlers over
  HTTP. The pair checks draft silence, publication/update/move, the 15-second
  default and timeout filter, receiver unreachability/save success/retry,
  password protection, trash, permanent deletion and outage behavior. Retry
  proofs preserve same event identities/fresh signatures, editor permission/
  recovery reports, precise upstream failure reason, backoff/exhaustion,
  configuration recovery, killed pending-save grace, superseded work, failed
  settings/deleted withdrawals, real concurrent CLI lease contention and the
  45-second callback budget/deferred continuation.
- Actual **Polylang 3.8.11** creates languages/translations/menus through its
  real APIs. Its exported GraphQL snapshot is the only substituted boundary;
  actual menu, translated identity, logo/icon, global-styles REST save, home
  publication/withdrawal, language reassignment, alternate/no-fallback and
  settings status/retry behavior enter the installed runtime. Shared rows
  remain per language, design Site-wide.
- Integrated **WordPress CLI/scheduler → installed package/workerd/D1** covers
  40 multilingual entries, shared preparation, **24 → 8 → 0** pending
  continuation, actual <=40 GraphQL reads per run, lease exclusion, failed and
  incomplete-list safety, outage and recovery, complete pre-update pending and
  failed records, preserved event identities/attempt increments, missed moves,
  removal and English-home repair without Portuguese leakage. The retained
  local block-recovery regressions count actual fallback requests across one,
  two and three languages and two list pages: **39/40/39/39**, with literal
  pending counts and complete recovery. No previous partial/recovery proof was
  replaced or weakened.
- Added workerd regression holds an actual GraphQL response while a real CMS
  withdrawal arrives; releasing the older refresh cannot restore it. Both
  handlers retain POST-only `Allow`, `no-store` and refresh auth challenge.
  All D1 publication timestamps are aged by a year; actual home/entry HTML and
  withdrawal remain served through an outage and a fourth rebuilt Worker.
  Complete publication/event/attempt/withdrawal/ledger rows are compared across
  that update, before any recovery read. A further **sixty actual WordPress
  publications without recorded events** preserve the source smoke's exact
  batch size: multiple real CLI scheduler runs stay within forty requests,
  then all sixty exact HTML bodies are served with no additional CMS reads.
  The final progression is **44 → 28 → 12 → 0** pending, using **22/22/22/20**
  actual requests.
  `sixty-publications.json` retains each run and complete before/after records.

## Actual cron daemon

`daemon.json`, `cron-daemon.log` and `cron-process.txt` record the actual
BusyBox **crond 1.37.0**, container and process lineage, exact minute schedule,
working directory, pinned WP-CLI launcher, elapsed time, failed/recovered
records and public deliveries. The image is
`wordpress@sha256:668db37ba48bc8d8ec4ca2f22163a1c74d17216c97bf509e327168963a687117`,
with PHP **8.4.26**. Its job runs as the workspace uid/gid in disposable
Bedrock. Its root-owned spool is copied into the container's temporary
filesystem. It never installs a system/user crontab, touches live Sites or
runs WordPress's general scheduled events.

The final daemon run took **58.654 seconds** from startup through job completion.
A real failed save is retained, an additional change is written without save
hooks, and the GraphQL boundary returns online before the daemon starts.
`gq_events_now +120s` makes the saved retry due without spending an extra
minute on its backoff; the daemon itself waits for a **real wall-clock minute**.
No public delivery read, manual retry or new save occurs between daemon start
and its completed job. The job invokes `wp gq-events retry-due --quiet`,
recovers the exact event (one additional attempt), and default reconciliation
repairs the unrecorded change. Only then are public results read. The daemon
stops and its container, launcher, schedule and temporary MU-plugin observers
are removed, including on failures.

A preliminary rootless user-namespace probe was stopped after BusyBox could
not call `setgroups`. A first container spool was ignored because it was not
root-owned; that container was stopped. The corrected root-owned temporary
spool passed. These are local harness prerequisites, not changes to runtime
behavior or proof of Ploi's crontab API, production PATH, PHP-FPM completion,
editor-browser notices or deployed timing guarantees.

## Assertion inventory and decisions

`assertion-inventory.json` resolves **1,011 source assertions across all 26
suite/smoke/support files**: 1,000 have concrete runtime test/proof destinations;
11 are exclusively named Blueprint provisioning/readiness obligations. Mixed
rows explicitly retain presentation/wiring obligations as well. Each record
has original expression/span/blob, exact destination test/check and its current
span/hash. The six library suites retain all **139** expressions with their
original destination spans. Source `eaec134` remains the checkpoint; fetched
upstream `497a3ae` changes Composer CI only and none of the relevant paths.
Historical overlays #3–#9 remain unchanged and their hashes are recorded.

`assertion-map.json` is the reviewed input to the final inventory; the source
expression and named target remain reviewable together. This is not a claim
that a DTO renders a Site document: actual HTML composition, copy, metadata,
CSS/layout wiring, page headers, Astro routes, generation, provisioning,
Polylang installation/removal policy and `gq site check` remain explicitly
assigned to gq-site #77. Runtime gaps found during the inventory were filled
with the additional delivery/pair/REST/daemon/workerd checks above.

[runtime-handoff.md](runtime-handoff.md) reconciles source ADRs 0003–0009/0013
and 0010 diagnostics with accepted local ADRs 0001/0002, including cold lookup,
withdrawal/cache policy, shared presets, multilingual amendments and #9's
home-block-recovery budget correction. Source orchestration ADRs 0011/0012
remain in gq-site. No accepted decision text was rewritten as completed proof.

## Identities, results and limits

`candidate-artifacts.json` records actual consumed npm tarball SHA-256/SHA-512
integrity across clean consumer, P1, pair, multilingual and integrated workerd,
and the actual Composer ZIP SHA-256, WP-CLI PHAR hash and resolved Composer
versions. `installed-composer.lock` retains the exact disposable installation graph. The consumed npm bytes must match across every proof. These are
candidate identities; publication must use its separately validated retained
bytes and release manifest, not assume a future rebuild is identical.

Tested toolchain: Node **24.21.0**, pnpm **12.11.2**, Vite+ **1.1.0**,
TypeScript **6.0.3**, Alchemy **2.0.0-beta.79**, Effect **4.0.0-rc.115**,
workerd **1.20260901.1**, compatibility date **2026-09-08** (pinned engine's
supported target), plus the PHP/CMS versions above. No Astro version is claimed:
the consumer is deliberately framework-neutral and thin, invoking standard
Request/Response handlers and public Delivery DTOs; generated Astro
presentation/build wiring remains Blueprint-owned. No Wrangler migration
facade substitutes for Alchemy's installed-path lifecycle.

`verification.log` records the passing final **eleven-task DAG with zero cache hits**, local and installed
296-case suites, PHP/Composer/WordPress, P1, pair/retry/Polylang, daemon and
workerd checks. Focused red/green and inventory logs are retained separately.
Complete persistent evidence is in `persistence.json`, `aged-persistence.json`,
`retry-records.json`, `multilingual-records.json`, `inflight.json` and the CLI/
check records, rather than only an index claiming that proofs ran.

Historical limitations remain: **no live Ploi/PHP-FPM proof, no deployed
Cloudflare CPU/subrequest enforcement proof, no live GETQUICK GraphQL schema
proof**. Actual transport counts are local evidence, not deployed plan limits.
The GraphQL answers are fixtures exported from real WordPress/Polylang state;
the CMS plugin, CLI, signature/HTTP transport, installed npm consumer, Alchemy
providers and workerd/D1 remain real.

**P5 remains independent:** #10's local published-fixture implementation is
retained, but actual gq-content `GITHUB_TOKEN` CI access still awaits the final
push; it has not passed here. **P7 remains separate publication-recovery work.**
Neither pending release gate blocks this local #11 candidate record or
justifies a released-pair claim.
