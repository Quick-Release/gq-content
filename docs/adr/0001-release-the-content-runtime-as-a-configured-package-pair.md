# Release the content runtime as a configured package pair

Status: accepted, 2026-10-17. Package implementation remains pending.

The content runtime's CMS and Frontend jointly enforce publication delivery,
ordering and withdrawal. Following [gq-platform ADR 0001](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0001-ownership-of-work-across-getquick-repositories.md),
this repository owns both halves: `getquick/gq-content` and `@getquick/content`.
Use separate `cms/` and `frontend/` package directories and one version/tag,
starting at `v0.1.0`. Extract from the recorded gq-site source checkpoint with
fresh history and explicit source commit/path provenance; retain this
repository's existing history rather than importing filtered source history.

The Frontend provides an instance configured for one Site, rather than mutable
module-level configuration. It accepts explicit Site identity, language and CMS
configuration and server capabilities. It owns framework-neutral event and
refresh HTTP handlers, including authorization, validation and response policy.
The Blueprint owns thin framework adapters, manifest/environment loading,
binding discovery, provisioning and version pins.

Content keeps WPGraphQL and WordPress HTML. The HTML block renderer, preset and
container helpers join the runtime under [gq-site ADR 0018](https://github.com/Quick-Release/gq-site/blob/eaec13488d57b3d04059309b5b36de5d016f3de1/docs/adr/0018-ship-gq-designs-contract-and-renderer-as-lockstep-packages.md)
and [issue #2](https://github.com/Quick-Release/gq-content/issues/2), superseding
issue #1's original renderer exclusion. The public npm artifact has no private
design dependency or private design types; pinned contract fixtures are only a
development dependency for this repository's CI. Contract-node adoption and
existing-Site migration are separate decisions.

The CMS supports `gq_events_deliveries`, `gq_publication_events_timeout` and
`gq_events_reconcile` as extension points, retaining their current names and
semantics. `gq_events_now` is a testing seam; other PHP implementation symbols
are not a promised extension API. Scheduler delivery extension does not promise
additional post types or event-schema extensions.

Publish a plugin-root Composer ZIP as a GitHub release asset and a public npm
artifact from the same tag. Publication across registries is not atomic. A retry
resumes missing steps and verifies published artifacts; it must never overwrite
a published version. The pair is released only when both halves are installable
at the same version and the release gates pass. A partial publication blocks the
Blueprint switch. Registry enrollment/access and Blueprint adoption remain work
in their respective owning repositories.

These decisions were accepted in the issue #1 grilling session. The
[implementation contract](../specs/issue-1-content-runtime-extraction.md)
specifies the export/configuration boundary and preserves existing failure and
development behavior. Runnable proofs remain release gates, not assumptions
established by this ADR.
