# Paired release

The release CLI runs directly, outside cached task execution. Requires the pinned
Node/Vite+/pnpm toolchain, PHP/SQLite, Composer, Python, Docker and the published
Design compatibility development dependency. See the compatibility README for
its scoped registry credential. Ordinary consumers require no private credential.

From a clean committed checkout:

```sh
vp install --frozen-lockfile
# Install compatibility's frozen dependencies with its scoped read credential.
node scripts/release.mjs build .artifacts/release-candidate
node scripts/release.mjs inspect .artifacts/release-candidate
node scripts/release.mjs validate .artifacts/release-candidate
```

Build requires an empty destination. Never rerun build over an existing candidate.
Retain the entire directory: `release-manifest.json`, the ZIP, npm tarball,
`validation.json` and `logs/`. Manifest schema 1 binds version 0.1.0, tag v0.1.0,
source commit, both filenames and SHA-256 digests, and npm SHA-512 integrity.
Artifact inspection verifies metadata and the PHP version constant used by CLI;
actual installed WP-CLI bare/JSON version checks run in P2. File creation refuses
to replace a manifest; publication compares its exact bytes with GitHub and CI.
Treat this bundle as immutable storage, not as a recipe for deterministic rebuilds.

Validation always reruns all commands. Its schema 1 record binds the source commit,
manifest hash, fixed command inventory, successful exit codes and proof-log hashes.
A failed/interrupted run leaves an invalid record. Source changes, substituted
artifacts, missing commands or modified logs invalidate it. `GQ_RELEASE_BUNDLE`
selects retained bytes for the existing P1/P2/public-consumer/pair/retry/Polylang/
workerd/fixture runners; invalid inputs fail without falling back to packing.
The CMS packaging runner copies the selected ZIP into its legacy proof location;
it does not rebuild it. Compiling local tests never changes selected release bytes.

Local validation cannot establish repository-token access. After owner review and
an authorized push, manually dispatch `paired-release-validation.yml` at the exact
committed revision. It builds once, installs published fixtures with this
repository's GITHUB_TOKEN (contents/packages read), runs every proof and uploads
`paired-release-candidate` only on success. Download and use **that bundle** for
publication; do not use an independently rebuilt local pair. No publication step
runs in that workflow. A CI record from another revision/workflow, unsuccessful
run, mismatching bundle or altered validation record cannot authorize publication.
Expired/missing CI artifacts block publication; rerun validation with a new candidate.

Only after publication has separately been authorized:

```sh
# Download the successful workflow's paired-release-candidate to an empty BUNDLE.
# Check out its exact source commit with a clean tree.
node scripts/release.mjs inspect BUNDLE
node scripts/release.mjs publish BUNDLE CI_RUN_ID
```

Supply credentials through the process environment/credential manager. `GH_TOKEN`
(or GITHUB_TOKEN) needs gq-content contents write for tag/release assets and Actions
read; `GQ_REGISTRY_TOKEN` needs registry repository read and dispatch access, and
`GQ_COMPOSER_USERNAME` / `GQ_COMPOSER_PASSWORD` are a provisioned private proxy
Basic login. The registry owner must independently enroll getquick/gq-content in
release-packages.json with repository Quick-Release/gq-content and assetPrefix
`gq-content-`, and grant the registry deployment's GitHub credential read access.
This repository does not provision that access. npm publication uses vp/pnpm's
configured npm publishing credential for @getquick/content. Do not save an operator
OAuth token as a CI secret. Commands suppress publication subprocess diagnostics;
HTTP failures report status/origin without credential headers or response bodies.

Before writes, the CLI verifies the live successful CI run, downloads its retained
bundle, checks its proof hashes, checks live enrollment and dispatch access, and
authenticates the npm account and Composer proxy. It then resumes tag, GitHub assets, public npm
publication and Composer rebuild/verification. GitHub assets include the two
archives and manifest. A non-draft GitHub release is staged for registry discovery;
its existence alone does not mean the pair is available. Existing tag commit,
release visibility and asset bytes must match. Existing npm metadata, downloaded
tarball SHA-512 and SHA-256 must match. Existing Composer version/source tag,
package type, dist origin, optional SHA-1 metadata and downloaded ZIP SHA-256 must
match. Satis's own reference is not assumed to be the source commit: the actual
registry adapter records the release tag as source.reference and archives the ZIP.

Dispatch uses the existing `plugin_updated` event. Acceptance only requests a
rebuild; it cannot complete the pair. A missing Composer version returns
`status: partial`, `handoff: false`, exit 2. Retry the same command/bundle after
the registry owner confirms rebuild completion. Every attempt reads remote state
anew; matching completed stages are skipped, mismatches fail, versions/assets
are never overwritten. Errors return `status: incomplete`, `handoff: false`, exit 1;
a failed network/publication response can leave remotely available components.
Inspect/retry the same candidate to resolve that uncertainty. Only live matching
npm **and** Composer archives yield `status: complete`, `handoff: true`, exit 0.
No local journal or cached proof can mark a registry complete.

Validation also runs the consent proofs against the selected bytes: the Astro
fixture in Chromium (`consent-astro`), the workerd/local D1 Worker consumer
(`consent-worker`) and the TanStack Start consumer (`consent-tanstack`). They
install public npm dependencies from pinned lockfiles and Playwright's
Chromium; CI installs its system dependencies first.

The repository's `vp test` discovers Frontend tests and the eight release cases in
`scripts/release/*.test.mjs`. Without `GQ_RELEASE_BUNDLE`, the five publication
boundary cases run without credentials or retained artifacts; three real-pair
cases explicitly skip. Run just the release suites with:

```sh
vp test scripts/release/pipeline.test.mjs scripts/release/candidate.test.mjs scripts/release/services.test.mjs
```

Validation supplies its selected bundle to that same P7 command and runs all eight
cases without skips. The clean installed consumer discovers only its copied
Frontend tests; release scripts and test helpers are not shipped or exported.

P7's controlled service-boundary tests inject interruption immediately after npm
accepts the retained candidate, then retry, observe no repeated tag/asset/npm write,
block on missing Composer availability, and complete only on matching identities.
They also reject changed tag, substituted assets, wrong npm integrity and changed
Composer ZIP. Retained-input/CLI/adapter tests use the real selected pair. These
are controlled recovery evidence; final live registry identity verification belongs
to the authorized release execution (#13). No live P7 or released pair is claimed
by local tests. Partial availability blocks all Blueprint handoff.
