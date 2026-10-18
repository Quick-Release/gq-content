# Issue #3 implementation evidence

Scope: [Install and use a configured Frontend client](https://github.com/Quick-Release/gq-content/issues/3).
Recorded 2026-10-18. This proves the helper/client slice of P3/P4, not the full
paired release or later delivery, migration, protocol and real-WordPress gates.

## Source and delta

The source is gq-site `eaec13488d57b3d04059309b5b36de5d016f3de1`. Before copying,
`git -C ../gq-site fetch origin main` resolved both local HEAD and fetched
origin/main to that exact checkpoint. A diff of the relevant Frontend source,
migrations, CMS MU-plugin, smoke and ADR paths was empty. Source bytes used for
extraction were also compared with `git show <checkpoint>:<path>`.
[provenance.json](provenance.json) records source paths, Git blobs and SHA-256s.
There is no upstream delta and no newer source checkpoint. gq-content history
starts from its existing planning commit `4503818`; source history was not
imported or rewritten.

Adaptations from that source:

- Pure HTML, presets, container layout and language normalization preserve their
  algorithms. Language configuration is supplied explicitly; instance routing
  closes over its own canonical language objects. Public helper input/result
  types are exported without design-package or validation-library types.
- The client is configured in a closure instead of reading a Site manifest,
  Astro flags, endpoint environment or Cloudflare globals. It preserves method
  names, argument order, return types, query text, pagination, anonymous reads,
  HTML fallback/recovery, manual redirects and the eight-second deadline.
- The lazy server guard runs before binding access and transport. Each query
  loads fresh bindings. Credential destination comparison uses explicit
  `cmsOrigin`; Site identity is trimmed and must be nonempty. No slug policy was
  added. Runtime properties contain no configuration or credential values.
- `astro/zod` becomes pinned public `zod@3.25.76`; validation stays private.
  New failing public-boundary tests exposed credential echoes in GraphQL error
  messages and malformed error envelopes escaping as exceptions. The client now
  redacts current credential values from upstream diagnostics and returns a
  schema failure for invalid GraphQL envelopes. Raw transport errors remain
  discarded. These are explicit failure-safety deltas, not upstream changes.
- Tests use configured capabilities rather than internal-module or manifest
  mocks. Two templated fixture hosts become explicit `.test` hosts. Every
  original assertion expression is preserved after that documented substitution.

## Assertion allocation

[assertion-allocation.json](assertion-allocation.json) inventories all six
library suites, ten application suites, eight named smoke files and two private
support files from #1: 26 files and 1,011 assertion sites. Each assertion records
its immutable source span, enclosing test/check name and destination/owner.
Parameterized cases retain their full source tables in the migrated suites.
The six migrated suites preserve 139 assertion expressions across 52 expanded
tests, including all 18 expressions/13 cases from `wordpress-access`.

Pending allocations name the public delivery (#4), protocol/publication (#6),
settings/language (#7), retry (#8), reconciliation/readiness (#9) and installed
runtime proof (#11) responsibilities. Mixed HTML assertions need equivalent
runtime DTO/handler guarantees here; their HTML composition, titles, copy,
metadata, switcher markup and CSS wiring remain gq-site #77. Generation, deploy
scripts, Polylang provisioning and `gq site check` orchestration also remain
Blueprint-owned. Shell files are harness allocation rows, not claimed tests.
Private SQLite/WordPress stub support remains test-only work for the dependent
slices. No pending row is a completed proof.

Reproduce the inventory/preservation check with:

```sh
node scripts/assertion-inventory.mjs /data/code/getquick/gq-site
```

It reads the fixed checkpoint via Git, compares assertion ASTs with the migrated
suites, and rewrites the formatted allocation file. It requires that source
checkout only for evidence maintenance; package builds/tests/consumers do not.

## Verification

Approved seams: public helpers/configured-client API and packed installed
consumer. Focused red/green checks preceded the helper exports, configured client,
credential-echo fix and GraphQL envelope fix; focused suites and source typechecks
were run throughout. No internal seam approval was needed or requested.

The final `vp run validate` runs uncached tasks with build dependencies so
quality checks and package tests cannot race Pack's output cleanup. It checks:

- Vite+ Pack compiled ESM and declarations for explicit root/server exports.
- Vite+ formatting, type-aware lint/type checks, plus `tsc --noEmit`.
- Seven package-boundary suites: the six migrated suites and nine additional
  configured-client cases (61 expanded tests total).
- A new tarball, installed by pnpm in a disposable consumer outside the repo.
  User/global npm config is replaced with public-only config and token/auth
  environment variables are removed for the child processes. No private registry
  credentials are required. All 61 tests also run against that installed tarball.
- Strict NodeNext public-declaration typechecking without Node ambient types;
  direct Node ESM helper imports and a real HTTP WPGraphQL client read.
- An eight-file artifact allowlist: package metadata/README and six compiled JS
  and declaration files. No source tests, fixtures, credentials, Site imports,
  environment assumptions, unresolved project placeholders, private design
  imports or validation-library public types. Runtime chunks contain no Node
  imports or migration entry. Only public `zod` is a runtime dependency.

Additional cases prove binding freshness on a long-lived instance, configuration
isolation, canonical language object identity/routing, non-slug Site identities,
empty identity rejection, injected transport timeout behavior, language-specific
home/chrome queries and the exact `getSiteChrome(siteOrigin, options)` order.
Source access cases retain partial-pair refusal, HTTPS/origin/port/path/userinfo
restrictions, redirect refusal, anonymous access, server-only behavior and
secret-safe failures. The consumer is deleted after every proof run; tarballs
are temporary validation artifacts, not retained release bytes.

Tested tools: Node 24.21.0, pnpm 12.11.2, Vite+ 1.1.0 (Vite 8.3.3, Rolldown
1.2.12, Vitest 5.0.3, Oxlint 1.87.0, Oxfmt 0.72.0), TypeScript 6.0.3.
The pinned Vite+ graph produces a pnpm peer warning because its Vite alias has
package version 1.1.0 while bundled Vitest's peer range names Vite 6/7/8; the
bundled runtime is Vite 8.3.3 and the real build/test/consumer checks pass. Vite+
also carries deprecated transitive Yuku packages. Neither warning is presented
as an untested failure or repaired through an unreviewed toolchain override.

## Remaining boundaries

There are no issue #3 blockers. Publication delivery, migrations and handlers
are intentionally absent until #4/#6, rather than represented by successful
stubs. Full alternate-result identity proof follows delivery in #4/#7. The
migration export and installed Alchemy path proof follow in #4; adding that export
must update the consumer allowlist. P5 published design fixtures follow in #10;
no private design package is imported here. Workerd/real WordPress/cron/PHP,
Astro/Alchemy/Bedrock and live schema/deployed CPU proofs were not run or claimed
for this slice. No Cloudflare remote resource or secret was needed.

No push, publication, issue update or delegated review was performed. The parent
orchestrator owns the mandatory two-axis review from `4503818` and subsequent
release actions.
