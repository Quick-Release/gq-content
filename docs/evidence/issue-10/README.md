# Issue #10 — published Design fixtures (P5)

Implementation base: `f76b8bb96a2e9c0e7d9252e0aa8c3041741aeaf4` on main.
Local published-fixture compatibility passes. **P5 is still pending this
repository's Actions access/run on the final pushed revision.** No push,
publication, issue mutation, package-permission change or external repository
write was performed. The parent owns independent Standards/Spec review and the
final push; #10 must remain open until its CI proof is collected.

## Publication and access

Read the complete #10 and #1 bodies/comments, repository glossary/domain/tracker,
accepted content ADRs 0001/0002, local parent implementation contract, Platform
glossary/ADRs 0001/0004, and fresh Design #12 body/comments/release/run evidence.
[Design #12](https://github.com/Quick-Release/gq-design/issues/12) is open for
unverified downstream Actions access, not unpublished packages.
[v0.4.0](https://github.com/Quick-Release/gq-design/releases/tag/v0.4.0) was released
at `8fc14930811f9e4c76b59947a00a6582ec166eb8`;
[tagged CI 39091063825](https://github.com/Quick-Release/gq-design/actions/runs/39091063825)
succeeded, including publishing/installing the packages. The owner also records
[registry deployment 39091611083](https://github.com/Quick-Release/getquick-registry/actions/runs/39091611083).
These upstream records are context, not proof of gq-content access.

`registry.json` is a fresh authenticated registry read made here with
`vp pm view @quick-release/design-contract@0.4.0 --json -- --registry=https://npm.pkg.github.com`.
The approved pre-existing user npm token helper authenticated the local read and
actual package installation; no token/helper configuration values were printed
or copied. There was no environment package credential and no new secret was
created. The pinned package is **0.4.0**, with registry SHA-1
`f39fa58691872f927f8a14af6f680a6e2a77265b` and integrity:

```text
sha512-BnMqr09gF1tqXBqh92T7rezUHqQef0Pp3HYizZz3JZw7hGTrAEOa71GQ3aKHjMrgxSMRoAa1i/p59Ged9Hld7A==
```

The isolated compatibility workspace pins it as an exact dev dependency in its
manifest and lockfile. Root installation and default offline/local tests require
no private package. Frozen installation succeeds. All fixture reads use exported
`@quick-release/design-contract/fixtures/*` paths from the installed registry
artifact, including manifest/default, blocks/neutral, and all three layout files.
No local Design checkout, renderer package, copied fixture, REST migration or
production adapter is involved.

## Coverage and runnable evidence

See [commands and limits](../../../compatibility/README.md). The approved seams
are public HTML/helpers and packed artifacts/clean public consumer. The implement
and TDD skills were applied; the user's explicit parent-review instruction
supersedes implement's generic duplicate review step.

- `red.log`: initial test fails because its test-only projection does not exist.
- `first-green.log`: the first published self-hosted media case passes against
  the actual packed/installed public ESM entry.
- `compatibility.log`: incremental 12-case published fixture suite passes.
- `mutation-red.log`: intentionally dropping projected attributes fails **8/12**
  cases (media, manifest attribute preservation, nested media and container
  layout), while all **293** baseline consumer tests still pass. The projection
  was restored before final verification; no mutation remains in source.
- `p5.log`: final successful fixture/artifact/credential-free consumer command;
  both artifact file inventories and disposable SHA-256 hashes are included.
- `check.log`: formatting, lint and public/compatibility type checks.
- `validation.log`: all **11 tasks passed with zero cache hits**, including
  **293 local and 293 installed consumer tests**, preserving real
  WordPress/Composer, pair/retry/cron, multilingual and workerd/Alchemy evidence.

The fixture suite checks all **30 enabled manifest block names**, attribute
preservation at the public parser and CMS HTML pass-through; Video Hero's base
and seven media variants; LTR/RTL/fallback layout selections with nested paragraph
and unsupported HTML; empty container defaults; and manifest-advertised container
layout/spacing capabilities. Explicit Content cases verify constrained widths,
preset spacing, padding, inherited parent variables and preset CSS. Populated
container dimensions are not in these published fixtures; the explicit cases
are identified as such. Content retains its existing fixed decorative YouTube
title rather than adopting the fixture's custom iframeTitle. This proof does
not claim Design rendering, language resolution or site-data resolution.

The existing WPGraphQL/HTML tests are unchanged. The npm tarball's **15 files**
and plugin-root ZIP's **7 files** pass strict allowlists and text checks; private
imports/types/dependency fields, registry configuration, fixture/test files and
credential patterns are rejected. The clean consumer strips credential-related
environment variables and overrides user/global npm configuration with public
registry-only/empty files before installation. It installs only the public
package and public test tooling. Fixtures remain in the isolated development
workspace; compatibility tests import the clean consumer's public ESM re-export.
These are disposable proof artifacts, not a claim of paired publication.

Tested: Node 24.21.0, local Vite+ 1.1.0 (global CLI 0.3.0), pnpm 12.11.2,
Vitest 5.0.3, PHP 8.5.10, Composer 2.10.3. Existing full-proof logs retain actual
WordPress/Bedrock/Alchemy/workerd version evidence and historical limitations.

## Remaining final-push proof

`.github/workflows/design-fixtures.yml` uses this repository's `GITHUB_TOKEN`
with only `contents: read` and `packages: read`, uncached Vite+ tasks, live
registry identity/integrity verification, a frozen private dependency install,
public/compatibility checks, both artifact audits and the clean consumer suite.
Registry credential configuration is removed before consumer checks. No broad
personal/OAuth token is saved as a CI secret, and no fallback bypasses access.

At the already-authorized final push, require a successful **gq-content**
workflow registry read and installation with its repository token and all P5
checks on the intended revision. Retain the run URL/revision and uploaded
`p5-registry.json`/`p5.log`. A local helper, Design's CI or another downstream CI
cannot satisfy this. If GitHub Packages denies access, the package owner must
grant gq-content Actions read access in its owning session and rerun; do not
change external permissions here. Fork PR access is not assumed. Until that
proof passes, keep #10 open and P5 pending; this does not block independent
#11/#12 implementation or authorize release.
