# Published Design fixture compatibility

This isolated development workspace pins exact `@quick-release/design-contract`
**0.9.0** from GitHub Packages. Root development dependencies also pin the
published Design contract and renderer at 0.9.0 so both build and fixture
installation require approved package access. The fixture workspace stays
outside the root pnpm workspace. The packed public Frontend has no private
package dependency, and installed-consumer checks run without registry credentials.
Both workspaces pin pnpm 12.11.2; all JavaScript commands use Vite+.

Before either installation, configure the existing approved package token helper
or a narrow `read:packages` credential only for `//npm.pkg.github.com/`. Never
write credential values to the repository. Then run:

```sh
# From the repository root, with approved package access configured:
vp install --frozen-lockfile
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
private registry configuration removed, runs the regression suite,
and runs the fixture suite against that installed package's public ESM entry.
Fixtures resolve through the installed private contract's export map. They stay
in this development workspace and are never copied to the consumer or artifacts.
The consumer tests execute without registry credentials.

`projection.ts` is test-only: it transfers names, attributes, child nodes and
available content into the WordPress HTML input shape. It does not generate CMS
HTML, resolve dynamic site data or implement a production contract-node adapter.
All 30 enabled manifest names must resolve to their declared neutral fixtures,
retain their source attributes through parsing and traverse the HTML renderer.
Supporting CMS shells test shell identity and content preservation where that
shell is meaningful. Image uses a supporting image shell; Hero uses a foreground
shell; the published empty Carousel composes its required navigation child.
Shell bytes are not invariant: canonical presentation classes and variables are
expected under accepted Design ADR 0004 and local ADR 0006.

Published Video Hero variants check safe media, deferred playback, authored
escaped iframe titles and ordered accessible foreground content. Self-hosted
media has metadata preload without eager autoplay; YouTube uses `data-src`, the
privacy-enhanced origin and decorative accessibility attributes. Rejected media
keeps foreground content and only a safe available poster.

The three published layouts retain nested source text, unsupported saved HTML
and Hero media. LTR/RTL/fallback are fixture selections; Content does not resolve
Design languages. The published nested Container presentation fixture checks
independent responsive caps, Base and upward width overrides, explicit margins
and padding, and bare nested containers without inherited centering or gutters.
Legacy compound layout classes and parent-layout variables are rejected.
Preset CSS remains checked separately.

Every neutral fixture must parse with its attributes and child order intact.
Pattern tests explicitly enumerate missing-source blocks reported by
`onUnrendered`, and distinguish supported empty output from missing rendering.
Saved HTML is checked semantically because presentation may rewrite its opening
tag. Focused assertions cover native layout, responsive navigation, social
identities, Carousel media/order, source typography, links and media presentation.

Supporting Site text and a supporting preloaded Post are clearly labeled test
data, not published Design fixture data. They let native Site/Post blocks render
without fabricating producer output or changing fixture attributes. The published
Query has no selected items; a separate supporting composition case verifies
producer-selected order and hard failure for missing item context or unresolved
items. It never selects or fetches posts. Post Title and Post Content without
context must fail explicitly. Published Logo attributes are null and no Featured
Image source is supplied: these fixtures establish empty/title fallback behavior,
not positive image identity coverage.

The exact registry `0.9.0` installation and packed consumer run are release gates.
A local run using root-installed vendored `0.9.0` fixtures and an existing local
build is useful implementation feedback but does not establish registry access,
published artifact identity or a fresh packed-consumer pass. Fixtures are always
read through package exports; no fixture copies or fallback parsers are used.

The workflow uploads registry identity and P5 output. P5 remains pending until
this repository's workflow successfully fetches the package with its own token
and completes the compatibility/consumer checks on the final pushed revision.
See [local evidence and remaining gate](../docs/evidence/issue-10/README.md).
