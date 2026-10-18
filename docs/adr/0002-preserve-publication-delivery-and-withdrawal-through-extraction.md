# Preserve publication delivery and withdrawal through extraction

Status: accepted runtime decisions restated, 2026-10-17; package implementation
and package-boundary proofs remain pending.

These decisions originate in gq-site ADRs 0003–0010 and 0013 at
[`eaec134`](https://github.com/Quick-Release/gq-site/tree/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr).
They belong with the runtime that enforces both halves of the protocol. This
restatement combines their amendments; it does not claim the upstream
Blueprint ADRs have already been edited or that extraction is complete.

## Durable delivery and honest failure

The Frontend serves the publication store's last-known-good content without an
age limit. Refresh promotes only complete, valid reads, and conditional writes
prevent an older read from replacing a newer one. CMS outages do not remove
stored content. Unknown stored formats and invalid bodies fail safely.

Cold lookup is permitted for an entry the store has never held; ordinary
visits do not refresh stored entries. A confirmed unpublished route is missing
(404), a failed read is unavailable (503), and a moved entry redirects to its
new route. These combine
[0003](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0003-serve-published-content-from-a-durable-store.md)
and [0004](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0004-serve-entries-from-the-store-with-a-cold-lookup.md),
including 0004's amendment of the original no-visitor-read wording.

## Signed changes and withdrawal authority

The CMS sends signed notifications after saving changes, independently of
whether public delivery succeeds. The Frontend verifies signature, Site,
action and schema before CMS reads or state changes. Accepted events have
durable identities and ordering: repeats, retries and older events cannot undo
a newer change. Event bodies carry identities rather than trusted page content.

A withdrawal removes every stored route of an entry from public delivery
without needing a CMS read. Conditional promotion protects it from in-flight
or stale refreshes. Only a later publication can lift it. This preserves
[0005](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0005-refresh-publications-through-signed-cms-events.md)
and [0006](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0006-withdraw-publications-through-signed-cms-events.md).

Shared-setting changes refresh their shared rows rather than republishing
every entry. Design presets are shared, superseding the earlier per-entry
approach under [0007](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0007-refresh-shared-settings-through-settings-events.md).

## Retry and convergence

The CMS retains delivery outcomes, including deleted entries' withdrawals,
and retries the same event identity with a fresh signature. Bounded backoff,
pending recovery, a scheduler lease and a send budget prevent overlap and
unbounded retry work. Editors and operators can distinguish publication from
public delivery without exposing content or secrets. The server cron invokes
the runtime command; WP-Cron is not the delivery scheduler
([0008](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0008-retry-event-delivery-from-the-cms-on-a-server-cron.md)).

The CMS scheduler also asks the Frontend to reconcile missed changes. It
compares canonical shared content and the published-entry list, uses ordinary
ordering/withdrawal protection for refreshes, and rotates rereads to detect
changes not reflected in modification times. An incomplete list cannot remove
content. A D1 lease, request budget and persisted outcomes bound each run;
unfinished work is reported and continued later
([0009](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0009-reconcile-missed-changes-on-the-cms-scheduler.md)).

## Languages and readiness boundaries

Each language has its own home and chrome rows, routes and language-sensitive
settings subjects; shared design stays Site-wide. Missing/unavailable content
does not silently fall back to another language. Refresh, events,
reconciliation and readiness diagnostics must account for every configured
language ([0013](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0013-serve-each-language-from-its-own-shared-rows.md)).

The runtime provides store state, signed check and reconciliation evidence to
readiness callers. Blueprint orchestration, provisioning, independent-media
checks and production enablement remain outside this runtime
([0010](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0010-declare-a-new-content-site-ready-through-one-readiness-gate.md)).
Offboarding and artifact-only Site code hosting in ADRs 0011/0012 are not
runtime decisions to migrate here.

Historical live-environment limitations remain explicit; the
[extraction contract](../specs/issue-1-content-runtime-extraction.md) requires
package-boundary regression proofs without claiming to settle unrelated
deployed-environment questions.
