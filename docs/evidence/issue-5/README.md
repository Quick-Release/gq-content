# Issue #5 implementation evidence

Scope: [Install and diagnose the configured CMS plugin](https://github.com/Quick-Release/gq-content/issues/5).
Base: `f0b22a22198f176e2f1eb824d662e849b2b75fe0`. Recorded 2026-10-18.
The parent owns independent Standards/Spec review and the eventual push/release.
No issue edits, publication, push, parent-contract edits or delegated review.

## Provenance and allocation

Read issue #5 and parent #1 bodies/comments, AGENTS.md, domain/issue-tracker
instructions, local/shared glossaries, accepted local ADRs and extraction spec.
Applied implement and TDD with tests.md/mocking.md at the pre-approved installed
entry, real Composer/Bedrock, WordPress/WP-CLI and Site Health/version seams.
The user's instruction leaves independent two-axis review to the parent.

The gq-site checkout initially reported the reviewed `eaec13488d57b3d04059309b5b36de5d016f3de1`.
A fresh `git ls-remote origin refs/heads/main` resolved upstream to
`497a3ae11b5d15df3619f71ff24f095d9b5e8cbe`. The checkout subsequently also
reported that commit. Explicit delta review: its sole newer commit is #96,
site 0.18.3's CI Composer plugin/root policy, its CI smoke, fixtures, release
notes and development documentation. **All 20 relevant module, CMS smoke,
Bedrock configuration and source ADR paths are unchanged.**

[provenance.json](provenance.json) records checkpoint Git blobs, SHA-256s and
last source commits. `python3 scripts/cms-evidence.py /data/code/getquick/gq-site`
rechecks those bytes and the relevant upstream diff without writing gq-site.
The three modules are fresh ordinary additions under `cms/modules/`; no Git
history was imported and this repository's existing history is retained.

Adaptations from source: remove three templated plugin headers in favor of the
single package entry; replace both templated Site constants with constant-first,
string-only, trimmed identity lookup; suppress automatic invalid-identity
publication/withdrawal/settings events; guard event persistence and sending;
add safe send-command configuration failures and Site Health configuration
reporting; add CLI version and debug package/version/configured fields.
Endpoint lookup retains gq-config precedence and adds explicit environment
fallback if the helper is empty. Existing namespaces, record keys, wire fields,
post types, scheduler/reconciliation behavior, delivery reporting and health test
identity `gq_public_delivery` are retained. No extension API was added.

[assertion-allocation.json](assertion-allocation.json) overlays the immutable #3
inventory per source assertion for CMS events and CMS Polylang smoke. It names
later package proofs and Blueprint responsibilities without claiming the old
cross-pair assertions pass here. CLI invocation/JSON/quiet and real signed
publication/settings transport are smoke checks in #5; full publication,
settings, retry and reconciliation guarantees remain #6–#9, with multilingual
and real cron integration in #11. Provisioning, readiness orchestration and
crontab installation stay Blueprint-owned.

## Runnable checks

- `vp run cms` (or `vp run proof:p2`): PHP syntax, Composer validation, build ZIP,
  fresh Bedrock installation through Composer and real WordPress/WP-CLI proof.
- `vp run cms-package` (or `vp run build:cms`): plugin-root
  `.artifacts/gq-content-0.1.0.zip`; only Composer metadata, entry, modules,
  README and license. No tests, Frontend, credentials or Site configuration.
- `python3 scripts/cms-evidence.py /data/code/getquick/gq-site`: source provenance.
- `vp run validate`: existing complete Frontend validation, clean installed npm
  consumer, P1 real Alchemy lifecycle, and the new uncached P2 task.

The P2 proof uses public **Bedrock 1.31.7**, **WordPress 7.1.3** (matching the
reviewed CMS), **roots/bedrock-autoloader 1.1.0**, **composer/installers 2.3.0**,
**Composer 2.10.3**, **PHP 8.5.10**, **WP-CLI 2.12.0**, and WordPress's public
**SQLite Database Integration 3.1.0**. The full resolved PHP package list is
printed in the proof log. The native CMS minimum remains PHP 8.4.1, matching
source; this proof tests the recorded installed version, not a PHP matrix.

It creates a new Bedrock project under `.proofs/p2/bedrock`, requires this
package from the built local ZIP through a Composer package repository, and
uses the unchanged Bedrock bootstrap plus a Site-owned proof config file.
Composer installers chooses the MU-plugin directory; Bedrock discovers and
loads the single entry automatically. No custom test loader registers the
modules. Artifact hash/reference and SHA-1 verification avoid stale local
Composer dist cache; every installed file is compared with the current ZIP.
WP-CLI and SQLite downloads use pinned public versions, so WP-CLI need not
already be on PATH. The project, database and downloads are disposable. No
Cloudflare account/token, private registry, live Site or provisioning is needed.

The receiver listens on an ephemeral loopback port and independently checks
actual WordPress HTTP envelopes and HMAC signatures. It acknowledges receipt;
it does not implement the Frontend. Tests observe real WordPress save/read APIs,
CLI commands and Site Health hooks, without PHP stubs or internal-function mocks.
Loading is checked at the installed entry, including module inclusion order and
repeat `require_once` safety. No extra plugin file loads the modules.

Configuration cases cover absent/empty/whitespace process identity; defined
empty/whitespace, integer, boolean, null and array constants over a valid process
value; valid environment identity and constant precedence with trimmed Unicode,
spaces, slash and colon (no new slug rule). Invalid identity does not break
saves, retain malformed envelopes, send any HTTP request, or report delivery
success. CLI check/retry/settings retry/reconcile/retry-due fail safely. A valid
identity with absent endpoint, missing/short secret retains correctly identified
failed production deliveries and reports unconfigured. Unconfigured development
skips automatic events. Version works without configuration and with an invalid
defined identity. Debug information reveals no configuration values or secrets.

Narrow red/green observations: the initial installed-consumer test failed on
missing CMS package metadata, then passed after packaging/extraction/version;
the production health/configuration test failed against the extracted source,
then passed with safe configuration diagnostics. Subsequent cases refined
identity and transport coverage. The harness additionally caught stale Composer
ZIP caching during iteration, fixed by artifact identity and installed-byte
verification. Focused P2 and type/quality checks ran during implementation.
Final runnable outputs are retained in [validation.log](validation.log).
The complete validation passed: 101 repository tests, 101 clean installed
consumer tests, quality/type checks, both P1 lifecycles, and 110 P2 checks.
After adding the full GPL license and deriving the installer's package metadata
directly from the ZIP, the final installed-plugin P2 run again passed all 110
checks. [proof-artifacts.json](proof-artifacts.json) records that validated
local ZIP and pinned download checksums; it is not a publication manifest.

## Limits

This completes #5's installed-plugin/configuration proof slice, not the parent
P2 gate or the paired release. The HTTP receiver does not prove Frontend store
updates, superseding/order, multilingual semantics, bounded retry recovery,
leases, lost-event reconciliation, or a real cron daemon. Those are explicitly
allocated to later issues. No live Ploi/PHP-FPM timing, deployed Cloudflare
CPU/subrequest limit, private GETQUICK GraphQL schema, registry enrollment or
published artifact availability is claimed. Source extraction retains the
existing dispatch behavior for the later proofs. Only local artifacts are built;
the final release must retain and publish its exact validated artifact bytes.
