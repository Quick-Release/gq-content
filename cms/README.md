# GETQUICK Content CMS

`gq-content.php` is the single plugin entry point. Install the plugin-root ZIP
as `getquick/gq-content` (`wordpress-muplugin`) through Composer. Bedrock's
`roots/bedrock-autoloader` 1.1.0 discovers this entry; it loads publication events,
settings events, delivery retries, archives, then forms using `require_once`. Do not load modules
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

`wp gq-events version` prints `0.4.2`; `--format=json` prints
`{"package":"getquick/gq-content","version":"0.4.2"}` even without configuration.
Existing commands are `status`, `check`, `retry <post-id>`, `settings status`,
`settings retry <setting>`, `delays`, `retry-due` and `reconcile`.
Shared settings subjects are `menus`, `logo`, `identity`, `design`, `patterns`,
`archives`, and for CONSENT-1/LEGAL-1 `legal` (sent on gq-config's `getquick_config_legal_changed`)
and `analytics` (sent on `getquick_config_options_updated` for the `marketing`
area, its GA4 toggle and measurement ID). Both refresh every language's chrome
on Frontends that enable consent CMS settings; others refresh the chrome as is.
Delivery health names them "The legal pages" and "The analytics settings".
`patterns` is sent when a synced pattern (`wp_block`), template, template part
or navigation menu (`wp_navigation`) is saved or deleted, a classic menu one of
them shows by id (`menuId`) is saved, or the theme changes, so the Frontend
refreshes the chrome's GQ Design header and footer. The menus patterns show are
indexed in the `gq_settings_pattern_menus` option as they are saved. Pattern sync-meta changes and GQ Design's
public `getquick_design_cache_invalidated` hook also refresh patterns, including
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
supported extension APIs. Publication events cover pages, posts and every
public custom post type shown in WPGraphQL (a Frontend may store them as
collections).

GETQUICK → Archives (Settings → Archives without gq-config) assigns a Page to
each public custom post type's archive (`gq_archive_pages`). The type then
yields its archive's URI to the Page; its items keep theirs. WPGraphQL's
`getquickArchives { postType uri page }` says where each archive is, and saving
the setting (or an assigned Page) sends an `archives` settings event ("The
archive pages"); deploy the Frontend that knows it first. Site Health's "Pages
reachable at their addresses" names published Pages whose URI resolves to
something else, such as a child of an archive Page that a type's single-item
rule claims (the Site moves its items' rewrite slug). See ADR 0005.

Headless Gravity Forms (gq-platform ADR 0009, local ADR 0008) is dormant
unless Gravity Forms is active. Then WPGraphQL's `ContentNode.getquickForms` holds
the public descriptors (JSON) of the forms a published, unprotected entry
references, through blocks, synced patterns or `[gravityform]` shortcodes. A
descriptor never contains notifications, entries, feeds or admin settings.
Saving a form or its confirmations, or activating, deactivating, trashing,
restoring or deleting it, sends a publication event for each entry that
references it. `wp gq-forms status [--format=json]` lists each referenced form,
its readiness diagnostics (unsupported fields and settings, unavailable forms)
and the URIs that reference it. It exits 1 while any form has a diagnostic.
Site Health debug information says whether the module is active.
`GetQuick\Content\Forms\published(int $form_id): bool` says whether a published,
unprotected entry references the form. It is cheap enough for every anonymous
request: a Site's CMS gate (gq-site's `content-api.php`) can open Gravity Forms'
submissions route only for those forms. It reads one stored set of form ids
without a query. A request that saves or deletes a page, post, item or synced
pattern reads the set again from content as it ends. A set is also read again
when post types change or after an hour, which bounds staleness after content
is changed without saving (SQL, imports, `wp search-replace`).

Run `vp run cms` for the reusable P2 installed-plugin proof, or
`vp run cms-package` to produce `.artifacts/gq-content-0.4.2.zip`. The archive
contains only plugin files, not tests or Frontend code. The proof uses PHP,
Composer, Python 3, curl, SQLite and downloaded WP-CLI; it installs the archive
through real Composer installers into a fresh public Bedrock project and boots
real WordPress. All disposable files and downloads stay under `.proofs/p2`.
See [#5 evidence](../docs/evidence/issue-5/README.md) for versions and proof limits.
