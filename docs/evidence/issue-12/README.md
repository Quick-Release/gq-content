# Issue #12 — resumable paired release

Implementation base: dae60b4ba0224000b7a66fb2edeea47a19657f5b. Scope is solely
this repository's release pipeline. No push, tag, npm publication, dispatch,
external repository write, permission grant, issue mutation or Blueprint change
is part of this implementation. The parent owns independent Standards/Spec review.

Read full #12/#1, repository instructions/tracker/domain/glossary, accepted ADRs,
parent spec, #10/#11 proof evidence, Platform glossary, and registry source read-only.
The live registry enrollment file was fetched from GitHub during implementation;
it contains nomia-blocks and gq-theme only. Registry scripts/release-packages.mjs
selects non-draft release assets by prefix/version, reads their Composer metadata,
sets source.reference to the release tag and gives the exact downloaded ZIP to
Satis. The proxy uses client Basic authentication, rewrites metadata dist URLs to
proxy.composer.getquick.io and serves archives through the same proxy. The
pipeline implements these observed boundaries without modifying the registry.

See [release operations](../../releasing.md) for reproducible commands, manifest,
validation schema, credentials, CI and enrollment gates, failure/recovery and
partial-availability semantics. Retained bundles are under ignored .artifacts;
the whole bundle must be preserved. Historical #3–#10 allocation/provenance is
unchanged. #11's final inventory is regenerated solely for changed proof runner
line offsets/hashes; all 1,011 original assertions and ownership remain allocated.

TDD used the approved CLI/orchestration boundary and external publication service
boundaries. red.log records the initial absent pipeline failure. The controlled
interruption is after successful npm publication; retry skips the actual recorded
completed remote stages, requests the missing registry stage and explicitly stays
partial until Composer identity matches. Mismatch and credential/proof gates
refuse completion. Tests using selected real archive bytes reject substitution,
stale source records, npm integrity mismatch and Composer archive substitution.
These tests do not claim actual live registry publication recovery.

Verification logs and the retained bundle's per-command logs/validation record
record actual results. P5 local published fixtures can pass; exact-revision
GITHUB_TOKEN Actions access is pending the later authorized push/dispatch. The
new workflow and publication gate prevent substituting this local pass for CI.
Registry enrollment/deployment read access and publication/dispatch/proxy
credentials remain external owner gates. No pair is declared released here.
Historical limits remain: no live Ploi/PHP-FPM, deployed Cloudflare limits,
live GETQUICK GraphQL schema or generated Astro/Blueprint proof.

Pre-commit verification passed: all 11 Vite+ verification tasks, zero cache hits,
296 local and 296 installed consumer cases, installed Alchemy migrations,
Composer/Bedrock/WordPress/WP-CLI, pair/retry/Polylang, actual cron daemon and
integrated workerd regression. baseline-verification.log retains the full run.
fixtures.log separately records 296 installed consumer cases and all 12 published
fixture checks; registry.json records the live 0.4.0 metadata read. check.log and
types.log retain clean quality/type checks. recovery.log records the standalone
controlled tests; its three selected-artifact checks deliberately require a bundle
and run without skips during the subsequent committed-revision validation.

The final committed candidate is built into `.artifacts/issue-12-retained` and
validated with `node scripts/release.mjs validate .artifacts/issue-12-retained`.
Its manifest and validation.json provide the exact source SHA, archive identities
and complete per-command results, including selected-artifact recovery/CLI tests.
No later evidence commit is needed to mutate the candidate's source revision.
The later authorized CI run builds and retains its own pair once; publication
must use that CI bundle, whose bytes are not assumed equal to this local pair.
