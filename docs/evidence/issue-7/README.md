# Issue #7 implementation evidence

Scope: [Deliver shared settings and multilingual updates](https://github.com/Quick-Release/gq-content/issues/7).
Base: `49b194340a6031df533468b82487f328e1ab2464`, main. Recorded 2026-10-18.
The parent owns independent Standards/Spec review and subsequent push/publication.
No delegated review, issue update/closure, parent edit or other repository write.

## Contract and provenance

Read #7 and parent #1 in full with `gh issue view --repo Quick-Release/gq-content
--json title,body,comments` (no comments), AGENTS.md, tracker/domain instructions,
local/shared glossaries, accepted local ADRs/spec, Platform ADR 0004 and #3–#6
proof evidence. Applied the requested implement/TDD skills, tests.md/mocking.md
at the already approved configured public handlers/read APIs, installed consumer
and actual CMS settings/menu/design seams. The parent's explicit review ownership
supersedes implement's duplicate review instruction. Workers best practices and
its runtime reference informed the workerd fixture; checked Cloudflare's
[testing guidance](https://developers.cloudflare.com/workers/testing/).
The existing Alchemy pin, provider types and supported compatibility date remain.
No new Worker infrastructure, remote Site, credential or Sigilo token was needed.

`node scripts/settings-evidence.mjs /data/code/getquick/gq-site` checks the live
upstream identity and relevant delta and regenerates the provenance/allocation.
Upstream remains `497a3ae11b5d15df3619f71ff24f095d9b5e8cbe`. All **15** affected
settings/language runtime, CMS and smoke paths remain byte-identical to the
reviewed extraction source `eaec13488d57b3d04059309b5b36de5d016f3de1`.
The 10 upstream changed paths are CI Composer policy, its smoke/fixtures,
release notes and development documentation. [provenance.json](provenance.json)
records all changed paths and immutable source blobs/SHA-256s. No checkpoint
change, history import, Blueprint/provisioning or registry modification.

## Behavior and assertion allocation

Inspection of #6's extracted settings/check path confirmed the required
production behavior was already present. **No production runtime change was
necessary.** This slice completes its package-boundary regression and real
multilingual installed-pair evidence without incidental schema/feature changes.

Settings notifications remain signed identity-only events. Menus/logo refresh
chrome; shared identity refreshes home/chrome in every language; translated
identity refreshes only that language's home. Menus and identity have separate
language subjects; design is one Site-wide row. Reads combine the shared presets
with existing stored entries, including an entry whose later CMS read has older
presets. Settings require no entry republish or read. Failed/partial reads retain
last-known-good rows and can retry the same identity. Duplicates and older events
cannot undo newer outcomes; concurrent promotions retain ordering.

The **46** new cases in `frontend/tests/settings-languages.test.ts` project
settings.test.ts, languages.test.ts and language-updates.test.ts onto configured
standard handlers and public home/entry DTOs. They cover both language homes,
menus/title/tagline/icon/logo/presets, locale normalization, default/secondary
routing, canonical alternate object identity, cold English entries, English-only
home alternates, legacy default-language entries and absent/unknown design
formats, moves to language homes, publication/withdrawal in each language,
no fallback for missing/unavailable/wrong-language reads, failed settings,
signature/schema rejection, superseding/retry, independent setting/language
subjects, older in-flight reads, targeted-home rejection, multilingual refresh
readiness and signed check state. Persisted-format inputs are fixture setup;
SQL introspection is not the assertion seam. Transport/time are boundary seams;
there are no internal runtime/module mocks.

[assertion-allocation.json](assertion-allocation.json) overlays **318 source
assertion spans**, preserving the #3–#6 inventories. Each names its source
span/context and new test/proof or remaining owner. SQL row/time introspection
becomes public delivery/duplicate/order behavior; actual CMS records/CLI shapes
are independently retained in the real pair proof. Source custom `expectSent`
helper calls additionally map to real CMS events. Site HTML document composition,
metadata, hreflang markup, switcher, translated copy and CSS stay in gq-site #77.
Polylang deploy/provisioning policy stays there too. The three multilingual
reconciliation tests remain explicitly **#9**, whose handler still returns the
documented 503 failure. Retry scheduling remains #8; neither is claimed complete.
All prior guard-before-bindings, fresh credentials, access, withdrawal, identity
and protocol tests remain active and unchanged.

## Real multilingual installed pair (P2/P6 settings slice)

`vp run multilingual` builds and runs the existing fresh Composer/Bedrock P2,
then the #6 real pair proof, then `scripts/multilingual-proof.py`. Every task is
uncached. The script packs using `vp pm pack`, installs with `vp install` and
pinned pnpm, and imports `@getquick/content/server` from that installed artifact.
It installs public **Polylang 3.8.11** into the actual P2 WordPress installation.
Languages, defaults, URLs, translated pages and menu locations are configured
through the real Polylang model. String translation uses real `PLL_MO` term-meta
persistence. No `pll_*`, PHP sender, loader or WordPress API is replaced.

A Site-owned proof exporter, `cms/tests/multilingual-export.php`, snapshots real
WordPress/Polylang state at shutdown priority 900, before the installed plugin
sends its signed events at 1000/1001. These snapshots supply explicit GraphQL
boundary responses; the package still chooses its own queries/language variables,
validates responses, applies ordering and stores publications. The exporter does
not call settings/publication functions or synthesize emitted events. It is
excluded from the CMS ZIP, removed from the installed Site after the run and is
never installed in a production consumer. The receiver/store and fixtures are
proof-only files, excluded from npm.

Actual WordPress menu reassignment/edit, translated tagline, site title, logo,
icon and global-styles post saves go over WordPress's HTTP transport into the
installed package handler and are observed through public reads. The proof
asserts no entry/list reads during settings updates, no event for an unassigned
menu, only English queries for English settings, both languages for shared
settings, outage persistence, failure records and successful same-identity CLI
retry with preserved output/attempt counts. Real English home saves/withdrawals
use Polylang's `/en/` route and language identity; settings cannot lift that
withdrawal, and later actual publication restores it. Withdrawing an English
translation removes its alternate while Portuguese remains available; an
unavailable English route never falls back. A real Polylang language reassignment
then moves the same node from `/sobre/` to `/en/sobre/`, preserving node identity
and selecting English chrome at the new route. CLI status retains the four shared
and four language subjects with the original six output fields.

[multilingual-records.json](multilingual-records.json) retains the observed event
wire envelopes, operation/language variables, CMS settings CLI rows, real failed
setting record, CLI retry output and final boundary snapshot. The records contain
no signing key. [proof-artifacts.json](proof-artifacts.json) records checksums and
exact versions for the tested ZIP, tarball and Polylang archive. They are local
validation artifacts, not a release manifest or published artifact claim.

## Validation and limits

`vp run validate` passed **uncached**: **268 tests** (prior 222 + 46 new), the
same 268 tests in the clean installed consumer, package/declaration/artifact
inspection, type/format/lint checks, `tsc --noEmit`, fresh real Composer/Bedrock
P2 (110 checks), the prior publication pair (18 checks), and the new multilingual
pair. [validation.log](validation.log) retains the full command output. The final real-language-reassignment extension reran the complete uncached
CMS/publication/multilingual pair chain successfully; its output is retained in
[multilingual-validation.log](multilingual-validation.log). Evidence
maintenance and final quality/PHP/diff checks are recorded separately in
[final-checks.log](final-checks.log).

The existing real Alchemy P1 lifecycle still applies all five installed migration
files before Worker creation and preserves complete migration/DB identities,
publication rows and delivery across a Worker update. Its extension now applies
signed English-home and shared-design events, checks canonical alternate objects,
compares English/default shared reads after update, and confirms durable settings
duplicate recognition. Prior publication/withdrawal/recovery assertions remain.
The initial added proof failed at the missing DesignPresets boundary answer
(503), then its bilingual fixture exposed missing language/translation fields;
the fixture was completed and the real lifecycle passed. The real language-change
proof also confirmed that a Polylang term reassignment changes the emitted URI
and language without inventing a `previousUri`; the store discovers the old
route by node identity and marks it moved. Production behavior
already passing source characterizations was retained; incorrect initial fixture
expectations about image field names, equal read timestamps and confirmed-missing
home readiness were corrected without changing the runtime contract. Focused
suite/quality checks ran throughout, including individual added behavior slices.

Versions: Node 24.21.0, global vp 0.3.0, Vite+ 1.1.0 (Vite 8.3.3, Rolldown
1.2.12, Vitest 5.0.3, Oxfmt 0.72.0, Oxlint 1.87.0), pnpm 12.11.2,
TypeScript 6.0.3; Alchemy/cloudflare-runtime 2.0.0-beta.79,
workerd 1.20260901.1, supported compatibility date 2026-09-08;
PHP 8.5.10, Composer 2.10.3, Bedrock 1.31.7, WordPress 7.1.3,
WP-CLI 2.12.0, roots/bedrock-autoloader 1.1.0, composer/installers 2.3.0,
SQLite Database Integration 3.1.0 and Polylang 3.8.11. P2 logs print installed
PHP versions; the Alchemy lockfile remains unchanged. Existing dependency
peer/deprecation and cross-device store warnings do not prevent proofs.

The actual CMS-to-consumer pair uses Node SQLite; local workerd/D1 persistence
is proved separately through the installed package and real Alchemy lifecycle.
This is not a live CMS-to-Cloudflare deployment. Full live GETQUICK GraphQL schema,
GraphQL language plugin interoperability, Site/Astro presentation, Polylang Pro
specific extensions, REST editor UI, live PHP-FPM/Ploi timing and deployed
Cloudflare limits remain unproved here. Real public Polylang behavior, CMS hooks,
HTTP signatures, consumer queries and durable public reads are proved. These
complete #7's settings/multilingual portion of P2/P6, not the entire release
gates. No issue #7 blocker remains.
