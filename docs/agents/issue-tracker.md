# Issue tracker: GitHub

Issues and specs live in Quick-Release/gq-content. Use the `gh` CLI,
with `--repo Quick-Release/gq-content` for issue commands.

## Operations

- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels`.
- Create: `gh issue create --title "..." --body-file <file>`.
- Comment: `gh issue comment <number> --body-file <file>`.
- Labels: `gh issue edit <number> --add-label "..." --remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

When a skill says to publish a spec or ticket, create a GitHub issue.
When it says to fetch a ticket, read its body and comments.

## Relationships

Use native GitHub sub-issues for parent/child relationships:

`gh api --method POST repos/Quick-Release/gq-content/issues/<parent>/sub_issues -F sub_issue_id=<child-database-id>`

Use native blocking dependencies:

`gh api --method POST repos/Quick-Release/gq-content/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-database-id>`

Get a database ID with `gh api repos/<owner>/<repo>/issues/<number> --jq .id`.
It is distinct from the issue number and node ID.

If native relationships are unavailable, put `Part of #<parent>` and
a `Blocked by` list in the child body.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding

A map is an issue labelled `wayfinder:map`; its tickets are sub-issues
labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`
or `wayfinder:task`.

Work unassigned, open children whose blockers are closed, in map order.
Claim with `gh issue edit <number> --add-assignee @me`.
Resolve by commenting with the answer, closing the ticket, and adding
a decision summary and link to the map.

## Ownership

Follow AGENTS.md's repository ownership rules when filing work.
