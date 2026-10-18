# Issue #12 Standards correction

Correction base: 72aa4707557d8bf04e7f7b0b0315e8d9addb01a5. Scope is the
Standards review response only. Independent Spec review remains with the parent.
No push, publication, dispatch, tag, issue edit or external repository write.

Platform ADR 0004 requires `vp test` and `vite-plus/test`. All eight release cases
now register synchronously with Vitest; the three real-pair cases use `test.skipIf`
instead of Node's different options signature. Root Vite+ discovery includes the
release suites. The P7 command inventory selects those three suites with `vp test`.
Five controlled publication boundary cases run without credentials or artifacts;
three selected-real-pair cases explicitly skip only when no bundle is selected.
No public exports or artifact allowlists changed. The clean consumer retains its
Frontend-only discovery and never imports repository release internals.

The duplicated pair/multilingual selection branches now call the small Python
`proof_package.prepare_npm` helper. It validates selected retained input through
the existing candidate CLI before copying, and packs with `vp pm pack` only when
no bundle is selected. Selection errors propagate without a fallback.
`selection.log` records an invalid selection failing with an empty destination;
the full proofs exercise ordinary packing and committed-bundle validation exercises
retained selection through pair, retries and real Polylang.

The existing CLI/orchestration and external service test seams were preserved.
`red.log` shows `vp test` unable to discover the release suites before correction;
`green.log` shows all eight discovered, five passed and three explicitly skipped
without a retained bundle. `check.log` and `types.log` record quality/type checks.
`verification.log` records the complete uncached verification run, including local
Frontend and release tests, clean installed Frontend tests, Alchemy, installed
Composer/Bedrock/WordPress/WP-CLI, pair/retry/Polylang/cron/workerd proofs.
`fixtures.log` records the clean installed consumer and all 12 published fixtures.
All checks passed: 301 local cases plus three explicit no-bundle skips, 296 clean
installed consumer cases, 12 fixtures, and all 11 verification tasks with zero cache
hits. Quality and TypeScript checks passed. These skips are absent from the
subsequent selected-bundle validation, whose logs are retained in that bundle.
`inventory.log` confirms all 1,011 source allocations and 139 library assertions.
Only destination line positions/file hashes changed in #11's final inventory;
source spans, runtime checks, ownership and Blueprint obligations are unchanged.

After these checks, commit the correction with #12 and build exactly once into
`.artifacts/issue-12-standards-retained` at the new clean committed HEAD. Run
`node scripts/release.mjs validate .artifacts/issue-12-standards-retained`.
The bundle's immutable manifest, `validation.json` and per-command `logs/` retain
the actual committed-revision results. In particular `logs/P7.log` must show all
eight recovery/input/CLI/service cases passing with zero skips. Final result is
reported to the parent after validation; no later evidence commit changes the
source binding. `.artifacts/issue-12-retained` remains historical evidence bound
to 72aa470 and is not rebuilt or validated with the corrected command inventory.

Local validation remains controlled recovery evidence, not a released pair or
proof of repository-token CI access. Publication still requires the authorized
exact-revision CI bundle and all existing remote gates. Historical live-platform
limitations and external enrollment/access gates remain as documented for #12.
