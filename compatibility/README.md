# Published Design fixture compatibility

This isolated development workspace pins `@quick-release/design-contract`
**0.4.0** from GitHub Packages. It is intentionally outside the root pnpm
workspace: `vp install`, `vp run verification` and `vp run installed` do not
install private packages. The public Frontend manifest has no private dependency.
Both workspaces pin pnpm 12.11.2; all JavaScript commands use Vite+.

Install the root dependencies with `vp install --frozen-lockfile`. With an
existing approved local package token helper, or a narrow `read:packages`
credential configured only for `//npm.pkg.github.com/`, run:

```sh
# From the repository root: confirm live registry identity/access.
node compatibility/registry.mjs
cd compatibility
vp install --frozen-lockfile --ignore-scripts
cd ..
vp run design-fixtures
vp exec tsc --noEmit -p compatibility/tsconfig.json
```

Do not put a credential in this repository. The committed `.npmrc` routes only
`@quick-release` to GitHub Packages and contains no authentication. GitHub Actions
uses this repository's `GITHUB_TOKEN` with `packages: read`; the package owner
must grant Quick-Release/gq-content Actions read access. A local login or another
repository's successful job does not prove that grant. A failed registry/install
step is a failing gate; there is no fallback credential or fixture substitute.
Fork PR tokens may lack access; run the trusted revision in this repository
before release, without using `pull_request_target` to expose credentials.

The uncached `design-fixtures` task builds both artifacts, audits every shipped
file, installs the public tarball in a disposable consumer with credentials and
private registry configuration removed, runs all existing 293 regression tests,
and runs the fixture suite against that installed package's public ESM entry.
Fixtures resolve through the installed private contract's export map. They stay
in this development workspace and are never copied to the consumer or artifacts.
The consumer tests execute without registry credentials.

`projection.ts` is test-only: it transfers names, attributes, child nodes and
available content into the WordPress HTML input shape. It does not generate CMS
HTML, resolve dynamic site data or implement a production contract-node adapter.
A supplied CMS shell tests HTML preservation for null-content fixtures. All 30
enabled manifest block names resolve to neutral fixtures; this is name/attribute
and HTML pass-through coverage, not a claim to implement Design node rendering.

Published Video Hero variants exercise real media attributes and overlay HTML.
The three published layouts exercise nested paragraph content and unsupported
HTML fallback. LTR/RTL/fallback are fixture selections; content does not implement
Design language resolution. Container fixtures have empty attributes, so their
actual defaults are tested separately from explicit Content layout cases using
manifest-advertised layout/spacing capabilities. These cases check constrained
widths, preset gap, padding and parent-to-child CSS variables, plus preset CSS.
The existing decorative YouTube title policy is preserved; the fixture's custom
iframeTitle is not newly adopted by this extraction.

The workflow uploads registry identity and P5 output. P5 remains pending until
this repository's workflow successfully fetches the package with its own token
and completes the compatibility/consumer checks on the final pushed revision.
See [local evidence and remaining gate](../docs/evidence/issue-10/README.md).
