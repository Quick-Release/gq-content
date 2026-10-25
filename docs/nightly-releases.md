# Content development nightlies

Every push to `main` runs `nightly.yml`, following
[ADR 0007](adr/0007-publish-development-nightlies-for-nomia.md). The source
package versions stay stable in git. In a disposable CI checkout, the producer
stages the next patch plus `-nightly.YYYYMMDD.RUN.ATTEMPT`, builds the Frontend
once, and packages the existing CMS allowlist and compiled npm allowlist. The
PHP header/constant and npm metadata use that SemVer; Composer uses
`dev-nightly-YYYYMMDD.RUN.ATTEMPT`, its supported development-version syntax.
The main source SHA remains the tag's target. Retry attempts have unique versions.

A published GitHub prerelease is the ready signal. It contains:

- `content-nightly-VERSION.zip`, the plugin-root Composer artifact;
- `getquick-content-VERSION.tgz`, the exact `@getquick/content` artifact;
- `content-release.json`, schema 1: channel, version, tag, full `sourceSha`,
  numeric `sequence`/`attempt`, `migrations.destructive`, plugin asset SHA-256 and
  runtime Composer metadata, plus npm asset SHA-256 and SHA-512 integrity.

The nightly-only plugin asset prefix deliberately differs from the stable registry's
`gq-content-` discovery prefix, so its hourly scan cannot ingest these development
versions. Both assets are uploaded to a draft before it becomes a visible prerelease.
Partial/failed runs never notify a consumer. Existing versions and assets are
never overwritten. Publication is serialized without cancelling an active
publisher; intermediate queued builds may be replaced. Older complete artifacts
remain selectable. These are development artifacts distributed through GitHub,
not public npm `nightly` or stable Composer releases. No npm publishing credential
is required; a consumer installs the exact authenticated tarball after checking
its declared identity and hashes. Never use GitHub's raw source ZIP as a plugin
artifact: it contains the source version, not the staged nightly version.

PR/main checks retain formatting, lint and type checks. The full compatibility
fixture proof is available by manual dispatch; `vp run validate` and the existing
stable candidate validation remain available explicitly. The nightly pipeline
runs no automated behavioral suites. Packaging verifies package identities,
version agreement, hashes and distributable file boundaries before publication.
The ordinary repository token needs Contents write to publish and Packages read
for the pinned Design build dependencies. No credentials enter the artifacts.

## Nomia adoption

The Site-owned shared nightly workflow installs this Content pair alongside its
selected Design nightly. It retains exact source commits, manifests, both package
locks and archives in one deployment snapshot, serializes CMS/frontend activation,
rejects stale producer builds and records the active Content identity. Automatic
activation is limited to the configured development destination with no traffic.
Nomia polls completed producer releases every five minutes and can select a
specific `content_tag` manually for immediate deployment or recovery. Receiving
a producer event does not permit activating an arbitrary unverified asset.

Optional immediate notification uses Actions variable
`NIGHTLY_DEPLOY_REPOSITORY=Quick-Release/nomia-bnq` and a dedicated
`NIGHTLY_DISPATCH_TOKEN` secret with destination Contents write. Do not store an
operator OAuth credential as a CI secret. Without that opt-in the producer
notification job is skipped and Nomia's scheduled discovery remains sufficient.
The `gq_content_nightly` payload is `{ repository: "Quick-Release/gq-content",
 tag, version, sourceSha, manifestAsset: "content-release.json" }`.

Authors must classify destructive changes in `nightly-release-policy.json`
before merging. `destructiveMigrations: true` becomes
`migrations.destructive: true` in the manifest and blocks ordinary automatic
activation until a reviewed snapshot-backed rollout. Search adds no migrations.
Routine updates do not force a backup cycle. Stable release and rollback rules
remain in [releasing.md](releasing.md); no existing stable tag/version is changed.

For local packaging diagnosis, use a disposable checkout: set `GITHUB_SHA` to
its clean HEAD and positive `GITHUB_RUN_NUMBER`/`GITHUB_RUN_ATTEMPT`, then run
`node scripts/release/nightly.mjs prepare`, `vp pack`, and
`node scripts/release/nightly.mjs pack`. `verify` rechecks the same assets without
rebuilding them. The output is ignored under `.artifacts/nightly/`. These local
steps neither publish nor deploy anything.
