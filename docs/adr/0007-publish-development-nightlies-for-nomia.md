# Publish development nightlies for Nomia

Accepted 2026-10-25 at the user's request, following GQ Design ADR 0005.
Every main push builds one immutable CMS/frontend Content pair for Nomia's
active-development Site. PRs and the default commit hook run formatting, lint
and type checks; nightly build/deployment paths run no automated behavioral
suites. Explicit tests and the full retained stable-release gates remain.

This is a development-channel exception to ADR 0001's registry-publication
requirement: a complete GitHub prerelease carries the plugin ZIP, npm tarball
and hashed exact-source manifest. Both halves are installable from those bytes;
nightlies do not update public npm `latest` or the stable Composer registry.
Content's public npm authentication differs from Design's GitHub Packages
publishing, and requiring an npm credential would delay the development loop
without improving artifact identity. Stable releases retain their existing
npm/Composer availability and CI gates.

Nomia owns opting in, installing both exact artifacts, serialized deployment,
stale-build rejection and recovery. A five-minute check can discover completed
releases without a cross-repository dispatch credential; optional producer
dispatch reduces latency. Destructive migrations require a recoverable snapshot
and separate rollout; ordinary updates do not require a backup cycle. A Site
leaving development opts out and selects a tested stable pair. Nightly bugs and
breaking changes are accepted for this development destination.
