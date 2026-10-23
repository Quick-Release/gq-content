# Canonical presentation build inputs

Immutable packed artifacts produced by the owning gq-design worktree, not
copies of shared sources. Contract: commit f3292fe; renderer: commit 8f18a4a
(native alignment and structural declaration followup). Parent issue:
https://github.com/Quick-Release/gq-design/issues/72.

Both packages are build-only dependencies. The content bundle embeds the
canonical presentation functions/model; consumers install only content.
Replace these artifacts together with their lockfile pins when the coordinated
family artifact is supplied. These are local integration inputs, not a claim
that version 0.8.1 in a registry contains the unreleased changes.
