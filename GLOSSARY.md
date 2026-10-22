# Content runtime

Terms specific to published-content delivery. Shared terms, including Site,
CMS, Frontend, Runtime and Blueprint, are defined in
[gq-platform's glossary](https://github.com/Quick-Release/gq-platform/blob/main/GLOSSARY.md).

## Language

**Publication store**:
A Site's durable copy of published content and shared chrome, retained so its
Frontend can serve visitors while the CMS is unavailable.
_Avoid_: cache

**Last-known-good content**:
The most recent complete, valid publication held in the publication store,
without an age limit; it remains until replaced by a newer read or withdrawn.
_Avoid_: stale content (as a fault)

**Missing content**:
Content the CMS has confirmed is not published at the requested route.
_Avoid_: unavailable content

**Unavailable content**:
Content whose existence cannot be established because the required read failed.
_Avoid_: missing content

**Publication event**:
A signed notification from a Site's CMS that published content changed,
identifying the change without carrying its content.
_Avoid_: purge

**Withdrawal**:
A signed notification that content stopped being public, preventing its public
delivery until a later publication permits it again.
_Avoid_: offboarding, purge

**Public delivery**:
The Frontend's confirmed application of a published change, distinct from its
successful save in the CMS.
_Avoid_: publish (for the Frontend's side)

**Reconciliation**:
Comparison of the publication store with what the CMS publishes, to recover
changes whose events did not arrive.
_Avoid_: full refresh

**Content extension**:
A Site's own content on its pages and posts, beyond what the runtime reads,
declared by the Site and stored and served with each publication.
_Avoid_: custom fields (WordPress's term for post meta)

**Cold lookup**:
A visitor's CMS read for content the publication store has never held.
_Avoid_: cache miss
