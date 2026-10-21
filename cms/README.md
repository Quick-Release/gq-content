# GETQUICK Content CMS

`gq-content.php` is the single plugin entry point. Install the plugin-root ZIP
as `getquick/gq-content` (`wordpress-muplugin`) through Composer. Bedrock's
`roots/bedrock-autoloader` 1.1.0 discovers this entry; it loads publication events,
settings events, then delivery retries using `require_once`. Do not load modules
as loose MU plugins.

Set `GQ_CONTENT_SITE_ID` to exactly the Frontend's `ContentConfig.site` (the
manifest identity). The plugin reads a PHP constant first, otherwise the process
environment, accepts only a string, and trims it. A defined empty/non-string
constant prevents environment fallback. Any nonempty identity is accepted; it
is never inferred from WordPress, URLs or the database. Configure the same
`PUBLICATION_EVENT_SECRET` (at least 32 characters) on the CMS and Frontend.
Endpoint lookup uses `getquick_config_frontend_url()` first, then
`GETQUICK_FRONTEND_URL`, appending `/gq/events`.

With missing/invalid identity, saves continue without recording or sending
malformed events. Without an endpoint/secret, development skips automatic events;
production keeps valid envelopes with failed delivery. Send/retry CLI commands
fail safely when unconfigured, and production Site Health is critical. Existing
valid delivery history is preserved. Site Health debug information includes
package, version and a configured boolean, with no credentials.

`wp gq-events version` prints `0.1.0`; `--format=json` prints
`{"package":"getquick/gq-content","version":"0.1.0"}` even without configuration.
Existing commands are `status`, `check`, `retry <post-id>`, `settings status`,
`settings retry <setting>`, `delays`, `retry-due` and `reconcile`.
Settings are `menus`, `logo`, `identity`, `design` and `patterns`; `patterns`
is sent when a synced pattern (`wp_block`), template or template part is saved
or deleted, or the theme changes, so the Frontend refreshes the chrome's GQ
Design header and footer. Pattern sync-meta changes and GQ Design's public
`getquick_design_cache_invalidated` hook also refresh patterns, including
linked-page/media dependencies. Hooks coalesce per request; reconciliation
repairs missed events.
The server cron remains `wp gq-events retry-due --quiet`; installing this package
does not install a cron or provision/enroll a Site.

Supported filters retain the upstream semantics:

- `gq_events_deliveries`: an array of delivery rows, each with `subject`,
  `label`, `event`, `delivery`, `deliver(array $event): array`, and optional
  `post`. The callback sends **and records** its own outcome and returns the
  delivery result. This extends scheduler inputs; it does not extend the
  Frontend's accepted event schema.
- `gq_publication_events_timeout`: publication delivery timeout in seconds;
  default **15**. Reconciliation retains its separate 60-second timeout.
- `gq_events_reconcile`: boolean enabling scheduler reconciliation; default
  **true**.

`gq_events_now` is a test-only clock seam. Other PHP functions/constants,
namespaces and WordPress hook registrations are implementation details, not
supported extension APIs. Supported publication post types remain page and post;
there are no new custom emitted actions or schemas.

Run `vp run cms` for the reusable P2 installed-plugin proof, or
`vp run cms-package` to produce `.artifacts/gq-content-0.1.0.zip`. The archive
contains only plugin files, not tests or Frontend code. The proof uses PHP,
Composer, Python 3, curl, SQLite and downloaded WP-CLI; it installs the archive
through real Composer installers into a fresh public Bedrock project and boots
real WordPress. All disposable files and downloads stay under `.proofs/p2`.
See [#5 evidence](../docs/evidence/issue-5/README.md) for versions and proof limits.
