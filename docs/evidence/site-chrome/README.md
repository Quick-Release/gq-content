# SiteChrome header and footer review

Review baseline: gq-content `d93345a24e428376f8f6f5df0b4ef158d9c628b7`,
with the existing uncommitted SiteChrome implementation inspected first.
This work completes that diff; it does not include a release or client Site
changes. Existing unrelated work was preserved. The follow-up commit/push
instruction isolated this diff on `feat/global-site-chrome`, based on main
`e1be280`, leaving the metadata branch unchanged. Review is tracked in
[PR #17](https://github.com/Quick-Release/gq-content/pull/17).

## Behavior and contract

`SiteChrome.header` and `.footer` carry `{ title, blocks }` or null. Both come
from public `designPattern` fields for one configured `designTemplate` (default
`page`), shared globally across content URLs. Null is final for that key;
Content does not fall through to another Design route. A registered key must
be chosen from the provider's manifest. `page` needs GQ Design 0.4.1+; `single`
and `search` need 0.4.2. No private Design dependency was added to the public
package.

Provider evidence was read from gq-design
`b18a61aa565ac77618c772f1e50f4c42155cafa7`:

- [Selection contract at 0.4.2](https://github.com/Quick-Release/gq-design/blob/v0.4.2/docs/template-selection.md):
  route keys, final null cases, separate per-route selection and serializer data.
- [Public pattern selection](https://github.com/Quick-Release/gq-design/blob/b18a61aa565ac77618c772f1e50f4c42155cafa7/src/Templates/PatternParts.php),
  `PublicTemplate` and `PublicPattern`: only public route/part sources (or
  public file/registered fallbacks) can select a published synced pattern;
  password-protected patterns remain hidden even for privileged viewers.
- [Producer regression suite](https://github.com/Quick-Release/gq-design/blob/b18a61aa565ac77618c772f1e50f4c42155cafa7/tests/graphql/public-selection-probe.php):
  anonymous/subscriber/admin, draft/private/pending/trash sources, protected and
  unsynced patterns, public fallbacks and separate authorized previews.
  Its existing local retained GraphQL log reports 3005 assertions. This session
  inspected that evidence; it did not rerun the provider's suite or modify its
  checkout. Consumer fixture tests are not a substitute for those producer tests.

Each language keeps its own ordinary menu and chrome row. `designPattern` has
no language argument and invokes `resolveElement` without language context.
Translated pattern trees and language-aware nested/menu serializer data are
**blocked by [gq-design #53](https://github.com/Quick-Release/gq-design/issues/53)**,
filed during this work. This implementation exposes the shared selection
honestly and does not fabricate translated IDs or query arguments. See
[ADR 0003](../../adr/0003-serve-cms-selected-header-and-footer-patterns-with-site-chrome.md)
for this explicit exception to language-specific chrome in ADR 0002.

## Regression coverage

Malformed nodes previously disappeared during parsing, allowing a partial
header to replace good chrome. New tests reproduced this with HTTP 200 where
503 was required. Parsing now rejects the whole malformed tree, bounds depth
and node count, and accepts PHP's empty attributes array. A separate regression
caught inherited JavaScript properties being treated as renderers; renderer
lookup now requires an own property.

Package-boundary tests cover assigned/unselected regions, configured route and
request shape, custom rendering and safe links, old format-1 rows, unusable
stored patterns, failed reads retaining both regions, retries using the same
identity, duplicates, older events, concurrent promotion, and reconciliation
repair/convergence including authoritative null. Language tests cover global
patterns with distinct menus/rows, shared-event propagation to every language,
invalid language subjects and withdrawal protection. Existing durable-delivery
tests verify retention without an age limit and unknown-format failure.

CMS proofs use real disposable Composer-installed WordPress and signed HTTP
transport. Each pattern/template/part source is saved, made draft/private,
trashed, restored and deleted independently. Sync eligibility meta, provider
invalidation-hook coalescing, and theme-event coalescing are also exercised.
The Design hook covers linked-page/media/serializer dependency changes beyond
pattern saves. The hook proof invokes the documented provider action; it does
not claim an end-to-end installation of GQ Design and WPGraphQL.

## Validation on 2026-10-21

- `vp run verification`: passed (exit 0). Includes 344 tests, 339 clean
  installed-consumer tests, formatting/lint/types, real CMS/CLI/transport,
  retry and Polylang proofs, local Alchemy/workerd reconciliation and TypeScript.
  Three release-candidate-only tests were skipped as expected. Reconciliation
  also passed year-old content retention, restart/withdrawal protection and
  recovery of sixty missed publications over bounded scheduler runs.
- `node compatibility/registry.mjs`: passed live access to the exact 0.4.0
  published fixture package using the existing approved local helper.
- `vp install --frozen-lockfile --ignore-scripts` in `compatibility`: passed.
- `vp exec tsc --noEmit -p compatibility/tsconfig.json`: passed.
- `vp run design-fixtures`: passed artifact inspection, credential-free
  installed consumer (339 tests) and 17 published-fixture compatibility tests,
  including header/footer regions and every neutral block fixture.
- `git diff --check`: passed.

Local registry access does not establish this repository's Actions access;
[gq-design #21](https://github.com/Quick-Release/gq-design/issues/21) remains
that separate gate. The retained release-candidate tests are intentionally
skipped without `GQ_RELEASE_BUNDLE`. No release validation/publishing workflow,
version bump, deployment or client Site mutation was performed.

Raw local run output: `/tmp/gq-content-site-chrome-verification.log` and
`/tmp/gq-content-site-chrome-fixtures.log` (ephemeral, not checked in).

## Isolated main-branch verification and merge gate

The metadata commits are excluded from PR #17. The initial test totals above
include that branch's separate metadata tests. On the isolated main-based
branch, unit tests pass (329 tests, with three release-candidate-only skips),
the installed consumer passes 324 tests, and published-fixture compatibility
passes 17 tests. Compatibility types and formatting/lint/types also pass. The complete
`vp run verification` run on this isolated branch passed (exit 0), including
the real CMS, retry, multilingual and local Worker reconciliation proofs.
Raw local output is retained at
`/tmp/gq-content-site-chrome-main-verification.log` and
`/tmp/gq-content-site-chrome-main-fixtures.log`.

[GitHub Actions run 39661663943](https://github.com/Quick-Release/gq-content/actions/runs/39661663943)
failed before fixture tests with HTTP 403 fetching
`@quick-release/design-contract@0.4.0` using this repository's `GITHUB_TOKEN`.
This reproduces the existing provider access blocker
[gq-design #21](https://github.com/Quick-Release/gq-design/issues/21).
`compatibility/README.md` treats failed registry access as a failing gate;
local credentials are not substituted into CI. Main remains unmodified while
that gate fails. No private package permissions were changed by this session.
