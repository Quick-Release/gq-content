# Runtime decision reconciliation and ownership hand-off

This is the #11 source mapping for the already accepted
[local ADR 0001](../../adr/0001-release-the-content-runtime-as-a-configured-package-pair.md)
and [local ADR 0002](../../adr/0002-preserve-publication-delivery-and-withdrawal-through-extraction.md).
It restates their final combined decisions; it does not change their accepted
status, turn an accepted decision into passed evidence, or amend Blueprint ADRs.
[Provenance](provenance.json) identifies every source ADR blob at `eaec134` and
the unchanged relevant paths through upstream `497a3ae`.

- **Source 0003, as amended by 0004/0005/0010/0013:** durable last-known-good
  content has no age limit; complete validated reads alone promote. Unknown
  format, malformed body and unavailable storage fail safely. Confirmed absence
  is missing, failed reads are unavailable. The Node migration entry supplies
  the installed SQL directory to infrastructure, outside browser/Worker graphs.
  Five original migration names/bytes/identities remain intact. Repeated deploys
  retain publication bytes and records. D1 provisioning/permissions and thin
  Astro binding discovery remain Blueprint obligations.
- **Source 0004:** cold lookup is allowed only for never-held entries; stored
  entries do not refresh on visits. This explicitly supersedes 0003's earlier
  blanket prohibition of visitor CMS reads. Canonical routes, moves, absolute
  and percent-encoded URIs, and conditional `read_started_at` promotion remain.
  Entry identity and read timestamps persist. Site HTML/layout/redirect adapters
  consume the returned delivery; the runtime does not own a Site document.
- **Source 0005, amended by 0006/0007/0009/0013:** signed events identify changes,
  never carry trusted page bodies. HMAC-SHA256 over timestamp/body, five-minute
  signing window, 16 KiB body cap, exact configured Site, action/schema checks,
  durable UUID/order and attempts, duplicate/supersede rules and safe failure
  responses are retained. Refresh uses a distinct secret, POST, at most 100
  explicit URIs and its existing validation order. `check` is authentication
  and bounded store evidence, not readiness by itself. The configured optional
  GraphQL credential pair replaces historical anonymous-only wording: credentials
  are restricted to configured HTTPS CMS GraphQL destinations, never redirects;
  visitor and automation credentials are not forwarded.
- **Source 0006:** withdrawal immediately hides all routes for an entry without
  reading CMS, and wins over older events, cold/refresh/reconcile reads already
  in flight and equal-millisecond publication. Only a later publication lifts
  it; failed republication remains missing until recovery. Durable withdrawn
  state survives updates. Blueprint pages must answer `Cache-Control: no-cache`
  and avoid edge-cache hits; package protocol responses use `no-store`. Delivery
  DTOs alone cannot set a framework page's headers. Existing rollback caveats
  for pre-withdrawal runtimes remain; this cut does not migrate existing Sites.
- **Source 0007, amended by 0013:** shared settings refresh shared rows without
  republishing entries. Shared design overrides per-entry presets; legacy or
  unreadable design retains page-local presets until valid shared design exists.
  Setting identities/order/retries are independent. The CMS observes actual
  option, menu, theme/global-style and Polylang changes. Unsupported post types
  and custom frontend actions are not added. The supported delivery filter is
  a scheduler extension whose callback records its own outcome.
- **Source 0008, amended by 0009:** CMS post/setting/deleted-entry delivery
  records distinguish successful save from public delivery. Retries keep event
  identity and use fresh signatures. Backoff is 1/2/5/10/30 minutes then hourly,
  stops at twelve attempts, and pending work gets a two-minute grace. A
  five-minute CMS lease and 45-second starting-send budget prevent overlap and
  defer remaining callbacks. Real server cron runs `wp gq-events retry-due
  --quiet`; WP-Cron is not this scheduler. CLI, editor REST and Site Health
  retain secret-safe states/reasons/attempts/last-run evidence. Ploi crontab
  installation, PATH/system-user provisioning, idempotence and operator workflow
  stay in gq-site. Actual local daemon execution is evidence below, not proof
  of Ploi API behavior or PHP-FPM response completion.
- **Source 0009, amended by 0013 and the #9 review correction:** each CMS
  scheduler run asks the frontend to reconcile. Canonical shared comparisons,
  complete-list-only removal, synthetic publication identities using CMS
  modification time, ordinary withdrawal/order protection and rotating rereads
  converge missed changes. D1 has a two-minute lease and complete persisted
  outcome/count/failure/matched-time evidence. Every run stays within forty
  actual CMS requests, including block recovery. The source's one-slot home
  reservation was insufficient: #9 reserves two per language home, one per
  chrome, one shared design, actual listing pages, two per entry and four for
  moves. The tested bilingual forty-entry continuation is **24 → 8 → 0**.
  This correction is explicit; source provenance is not rewritten. Unchanged
  modification times converge through rotating rereads, not a fixed five-minute
  guarantee. Large-list starvation and deployed CPU/subrequest enforcement
  limitations remain disclosed.
- **Source 0013:** default `home`/`chrome`, per-language `home:<slug>` and
  `chrome:<slug>`, shared `design`, route-keyed entries, own-language home
  resolution, canonical language object identity/alternates and no fallback
  remain. Publications and menus/identity settings name the affected language;
  logo/design/shared identity update every language. Reconciliation lists ALL
  languages and readiness reports each language's rows. Normalization and
  accepted identity/language domains are preserved, not tightened incidentally.
- **Source 0010 diagnostics, amended by 0013:** package signed check reports
  bounded state/counts and reconciliation evidence without content/secrets;
  unprepared, unavailable, behind, failed and matched are distinct. Refresh
  reports readiness across every language. CMS debug info exposes package,
  version and configured state; CLI version remains available unconfigured.
  The Blueprint retains `gq site check`, skipped-field GraphQL schema probes,
  CMS installer/plugin attribution, media upload/readback, Sigillo/permissions,
  production enablement and public-page/header checks. A Worker response,
  matching title or mere configuration does not establish readiness.

Local ADR 0001 also supersedes the historical Site-owned-copy deployment model:
both configured runtime halves now belong to gq-content, while manifests,
secrets/binding lookup, version pins, routes and provisioning remain Blueprint
work. The supported configuration and extension contract is the parent
[implementation spec](../../specs/issue-1-content-runtime-extraction.md), including
constant-before-environment `GQ_CONTENT_SITE_ID` and no guessed identities.
Source ADR 0018 assigns WordPress HTML helpers to this public package; it does
not introduce private design runtime dependencies or a contract-node renderer.

Source **0011/0012** offboarding and artifact-only hosting are orchestration and
stay in gq-site; they were not moved. No Blueprint ADR was edited. The
[final assertion inventory](assertion-inventory.json) identifies the exact
presentation/provisioning obligations still owned by gq-site #77, including
“Content skeleton: import the HTML helpers and WPGraphQL client from
@getquick/content.” The eventual hand-off must supply the verified paired
version, exports/configuration, installed migration path, supported extension
filters and readiness interfaces. This candidate is not that released pair:
P5's actual gq-content CI access and P7 publication recovery remain independent.
