# Issue #1 readiness investigation

Status: first-round recommendations accepted; implementation contract completed.
This investigation does not claim the runnable proofs passed. The session
authorizes specification work only; extraction remains a future task.
Investigated 2026-10-17.

## Sources and settled constraints

- [gq-content #1](https://github.com/Quick-Release/gq-content/issues/1)
  is the extraction and paired 0.1.0 release; [#2](https://github.com/Quick-Release/gq-content/issues/2)
  adds the HTML helpers to that same cut, superseding #1's renderer exclusion.
- gq-site local HEAD and GitHub main both resolve to
  `eaec13488d57b3d04059309b5b36de5d016f3de1`.
  [ADR 0018 at that checkpoint](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0018-ship-gq-designs-contract-and-renderer-as-lockstep-packages.md)
  keeps content on WPGraphQL and WordPress HTML. No production contract-node
  adapter, REST migration, shared commerce renderer or existing-Site migration.
- Public `@getquick/content` must install without private registry credentials,
  private design dependencies or private design types. The pinned contract
  fixture dependency is for this repository's CI only. Existing HTML tests remain.
- Package implementation, proofs and decisions belong here. Blueprint wiring,
  provisioning and pins belong in gq-site. Registry enrollment belongs in
  getquick-registry; contract publication/access belongs in gq-design.

## Inventory and boundary findings

CMS source is `blueprint/templates/apps/cms/web/app/mu-plugins/` in gq-site:
`publication-events.php`, `settings-events.php`, `delivery-retries.php`.
Both event producers embed `SITE = '{{project}}'`; the released plugin needs
explicit Site identity configuration. Keep event signatures, payloads,
persisted delivery records, retry/lease behavior and CLI contracts intact.

Frontend source is `blueprint/templates/apps/frontend/` in gq-site:

- `src/lib/{events,delivery,publications,reconciliation,wordpress,site-language}.ts`.
- `src/lib/{wp-block-renderer,wp-block-styles,wp-container-layout}.ts`.
- `migrations/0001` through `0005`, preserving names, SQL and order.
- All six helper/client/language suites named in #2, including
  `wordpress-access.test.ts`.
- Runtime suites at the source root: homepage, entries, routes, events,
  withdrawals, settings, retries, reconciliation, languages and language-updates;
  their SQLite D1 and WordPress stub support.
- Runtime portions of the WordPress/cron, workerd and language smoke harnesses.
  Separate reusable guarantees from generation/provisioning/live-Site checks.

The source-root suites mix runtime assertions with Astro Container rendering
of skeleton pages. Allocate each assertion explicitly: runtime behavior moves
to package API/handler tests; Site presentation and generated wiring stay with
the Blueprint. Do not move those suites unchanged and accidentally make the
package depend on the app skeleton. Keep an assertion-to-new-home inventory.

The manifest, `astro/zod`, `import.meta.env`, Cloudflare bindings and module-level
language configuration are current dependencies across the runtime, not just
the client. `src/lib/runtime.ts` is Site wiring but its binding interface is
needed by consumers. Framework dependencies and credential loading must have an
explicit boundary; changing imports alone does not establish server-only safety.

`src/pages/gq/refresh.ts:16–83` contains runtime protocol behavior: authorization,
request validation, the 100-URI limit, language-home rejection and status mapping.
`src/pages/gq/events.ts:13–26` owns response wrapping. Package-owned
Request/Response handlers were accepted so managed routes can stay thin.

Existing CMS custom filters are `gq_publication_events_timeout`, `gq_events_now`,
`gq_events_deliveries` and `gq_events_reconcile`. There are no custom emitted
actions. Delivery-row extension does not imply arbitrary post-type or event
support: the current post types are page/post and the receiver validates its
event schema. The accepted extension points are deliveries, timeout and
reconciliation; the clock override is a testing seam.

## Runtime decisions to restate

Restate the final combined runtime behavior from gq-site ADRs 0003–0009 and 0013,
and the diagnostic/interfaces portion of 0010. Do not duplicate 0011's
offboarding or 0012's code-hosting workflows. The `gq site check` orchestration,
media gate and provisioning remain Blueprint responsibilities.

Account for amendments: 0004 permits cold lookup despite 0003's original
no-visitor-CMS-read wording; 0007 replaces per-entry presets with shared design;
0013 makes home/chrome/settings language-specific. Preserve last-known-good
content, missing versus unavailable, ordered promotion, withdrawal protection,
signed events, retry persistence, reconciliation completeness and language isolation.

## Release and downstream facts

`internal/getquick-registry/README.md:34–43` and
`scripts/release-packages.mjs:96–122` support plugin-root Composer ZIP assets
from monorepos. `release-packages.json` enrollment and registry repository read
access do not yet exist for gq-content. Registry import is asynchronous; npm
publication, GitHub release assets and Composer availability are separate steps.
One version cannot make those registries publish atomically.

[gq-site #77](https://github.com/Quick-Release/gq-site/issues/77) already exists
as a native child of #1 for runtime pins, routes, migrations and ADR hand-off.
#2 additionally names “Content skeleton: import the HTML helpers and WPGraphQL
client from @getquick/content.” Record that downstream scope here; do not file
or implement it in another repository during this session.

[gq-design #12](https://github.com/Quick-Release/gq-design/issues/12) is open.
The local contract package at gq-design
`b9be6e0c7311d5741d57a1dec468cfab6b58f59f` is private/unpublished at 0.3.19;
#12 targets the first lockstep release at 0.4.0. Do not pin an assumed release.
Its access criteria name Ekis and gq-site CI; #2 additionally requires gq-content
CI access. Publication and this repository's access must be verified before the
compatibility release gate passes. Extraction work itself may proceed earlier.

## Questions requiring runnable proof

These are empirical acceptance gates, not questions for the user to guess.
None was run in this investigation.

1. **Alchemy migrations from an installed package.** The inspected Alchemy
   beta.79 source accepts a directory; no node_modules prohibition was found.
   Install the packed package through pnpm, resolve its migration directory,
   apply all five migrations through Alchemy to local D1, repeat without
   reapplication, and show migrations complete before Worker update. Preserve
   migration identity/history. Existing workerd smoke applies migrations via
   Wrangler and cannot answer this question. If Alchemy cannot run the package
   path, stop for a documented migration hand-off decision; do not silently copy SQL.
2. **Composer MU-plugin loading.** Install the release ZIP using
   composer/installers and roots/bedrock-autoloader 1.1.0 in real WordPress.
   Prove all three modules load once and in the required order, configured Site
   identity is used, CLI/cron commands work, and CLI/Site Health show the version.
   Current CMS smoke copies three loose files, so it does not prove this.
3. **Public packed npm consumer.** Clean installation without a private token;
   typecheck exported declarations and run public helpers/server integration.
   Inspect the tarball for excluded fixtures/tests/credentials/private imports.
4. **Server/client boundary.** Re-run the migrated Access suite against the
   chosen seam and packaged consumer. Browser reads must neither load bindings
   nor fetch; partial credential pairs fail before requests; credentials only
   reach the configured HTTPS GraphQL endpoint; redirects remain unfollowed;
   errors and logs remain secret-safe. Prove separate configurations cannot mix.
5. **Published contract fixtures.** Authenticate gq-content CI, install the exact
   released dev dependency, resolve its exported fixtures, and exercise the
   relevant names/attributes/layout behavior using a test-only projection.
   Contract nodes differ from WPGraphQL HTML blocks; preserve both test layers.
6. **Package integration and release recovery.** Run the migrated runtime
   suites and real WordPress/cron plus workerd smoke through package boundaries.
   Exercise a failed publication step and retry under the agreed release policy.
   Verify both package artifacts and registry-visible versions before declaring
   the pair released or allowing the Blueprint hand-off.

Existing ADR limitations about deployed Cloudflare CPU/subrequest enforcement
and live readiness are not silently new extraction acceptance requirements.
Keep those limits explicit when defining the final proof matrix.

## Decision tree

First frontier accepted by the user: fresh history with provenance; configured
instances and package HTTP handlers; supported CMS delivery/timeout/reconciliation
filters; separate CMS/Frontend packages and paired ZIP/npm release; resumable
partial publication without overwriting artifacts. Recorded in
[ADR 0001](../adr/0001-release-the-content-runtime-as-a-configured-package-pair.md).

The dependent details preserve existing contracts rather than introducing new
product decisions: server guards run before lazy binding access; bindings stay
fresh; language objects stay canonical within an instance; nonempty manifest
identities remain accepted; development live reads require explicit opt-in.
The frontier is empty after the user's acceptance and instruction to proceed.
The [implementation contract](../specs/issue-1-content-runtime-extraction.md)
records exact exports/configuration, CMS diagnostics, assertion allocation,
seven proof gates and release recovery. Its P6/P7 split refines item 6 above.
No extraction or proof execution was performed.
