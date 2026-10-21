# AGENTS.md

## Scope

This repository is gq-content, the content runtime: the CMS must-use plugin and the Frontend package that implement publication events, delivery, the publication store and reconciliation, their migrations, contract tests and ADRs. The blueprint (gq-site) only wires it into Sites and pins its version. Which repository owns what: [gq-platform ADR 0001](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0001-ownership-of-work-across-getquick-repositories.md).

Read any repository for evidence. Until 2026-10-30, change any GETQUICK repository the task needs, each in a worktree of that repository. After that date, restore the ownership rule from git history.

Terms shared across GETQUICK repositories are in [gq-platform's glossary](https://github.com/Quick-Release/gq-platform/blob/main/GLOSSARY.md).

## Sessions and orchestration

Sessions run inside T3 Code. A session started from this repository edits
this repository only. Work for any other repository runs in a new T3 session
on that repository, in a dedicated worktree of it; this session starts
nothing in the other checkout itself. Claude and Codex can always act as
orchestrators: launch that session with `t3_thread_launch` (a `worktree`
`workspaceStrategy` on the other repository's project), then follow it with
`t3_thread_wait` / `t3_thread_read` and report its outcome.

## Agent skills

### Issue tracker

For issue and spec operations, read `docs/agents/issue-tracker.md`.

### Triage labels

When assigning triage roles, use `docs/agents/triage-labels.md`.

### Domain docs

Before domain exploration, read `docs/agents/domain.md`.
