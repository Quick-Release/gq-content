# Public site-wide search

`createContentRuntime` exposes `search(query)` for a Site's search results page.
It searches public content already delivered to the publication store: pages,
posts, declared collections and the selected language's front page. It makes
no WordPress reads, including in development, and requires no event/refresh
credentials for reads. CMS outages retain last-known-good results without an
age limit. New content becomes searchable through the existing refresh,
publication-event and reconciliation paths.

```ts
import { createContentRuntime } from "@getquick/content/server";
import type { SearchDelivery, SearchQuery } from "@getquick/content";

// `content` is the Site's configured runtime.
const requestedPage = Number(url.searchParams.get("pagina") || 1);
const result = await content.search({
  search: url.searchParams.get("q") ?? "",
  page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  perPage: 12,
  language: content.routeLanguage(url.pathname).slug,
});

if (result.kind === "unavailable") {
  // Render the Site's unavailable-search message with HTTP 503.
} else {
  const { items, total, page, perPage, totalPages } = result.content;
  // Render escaped text fields and links; preserve q in pagination links.
}
```

The public types `SearchQuery`, `SearchDelivery`, `SearchPage` and `SearchItem`
are exported from `@getquick/content`. The result shape is:

```ts
type Result =
  | {
      kind: "found";
      content: {
        items: Array<{ title: string; excerpt: string; uri: string; language: string }>;
        total: number;
        page: number;
        perPage: number;
        totalPages: number;
      };
    }
  | { kind: "unavailable"; failure: { reason: string; message: string } };
```

`search` is required text. Matching is a normalized substring of title,
excerpt or body, ignoring case, accents and repeated whitespace. HTML is
converted to text with character references decoded; script, style, template
and comment content is excluded. Extension fields and chrome are not searched.
Blank/whitespace-only text finds nothing; it does not browse all content.
Result titles and excerpts are plain text, to be escaped by the Site's renderer.
Excerpts use the stored excerpt, falling back to body text, limited to 240 Unicode
code points. `uri` is the canonical Site path; `language` is always a configured
slug, even for a monolingual Site.

`page` defaults to 1 and `perPage` to 12. Both accept positive whole numbers or
numeric URL strings; a missing or empty string uses the default. `perPage` is
capped at 100. Nonfinite, fractional, nonpositive or unsafe pagination values
throw a configuration/input error, as does an unknown language or nontext
search. Values above `Number.MAX_SAFE_INTEGER / 100` are rejected so offsets
remain safe. Sites should validate URL inputs before calling the API.

Results are ordered by publication date descending, with canonical URI as the
stable tie breaker. The front page has no stored publication date and follows
dated entries. Totals count matches before pagination. A page past the end
returns no items with the same total; `totalPages` is 0 for no matches. Empty
results are successful HTTP 200 results, distinct from unavailable search.

Search uses the configured default language unless given another configured
slug. Route and stored-language checks prevent cross-language leakage, with
legacy rows lacking a language treated as the default language's. No language
falls back to another's home or chrome. Missing, moved and withdrawn rows never
appear, nor do collections no longer declared by the Site. Shared home rows
are searched at their language home path once, avoiding legacy entry duplicates.

The store must contain a readable home state and published chrome for that
language. A missing/withdrawn home is omitted while other published entries
remain searchable. An absent/unprepared store or unreadable publication in the
selected route language returns `unavailable` (`not-ready`); a failed store
read returns `unavailable` (`store`). Invalid rows fail the search rather than
silently reporting partial totals. Browser calls fail before reading bindings.
A store failure never enables a CMS fallback.

## Storage and scale

One SQL read snapshots the language's home/chrome and published entry rows.
Validation, visible-text extraction, matching, ordering and pagination run on
that snapshot, so totals and items agree even when publications change during
the request. The normal promotion/withdrawal rules govern these same rows;
search introduces no separate index that could retain a withdrawn item.

This deliberately scans stored bodies at the current few-hundred-entry scale
recorded in ADR 0005. Work and transferred bytes grow with stored publication
size. It is not a ranked full-text engine. Sites with thousands of entries or
large bodies should measure Worker CPU and D1 read sizes and introduce a
transactionally maintained search projection/index before scaling this path.
There is no new store migration, stored format, CMS query or CMS plugin change.
Existing 0.3.2 publications are searchable immediately. As with other delivery,
search reflects the store's delivered subset; a failed or incomplete refresh
does not claim that every CMS publication was delivered.

## Adoption

`@getquick/content` 0.3.2 has no `search` method. This change needs review and a
new supported paired runtime release through the existing release gates before
Nomia pins/adopts it. This branch leaves package versions unchanged and does
not authorize a release, registry publication, deployment or merge. Follow the
paired adoption policy in [releasing.md](releasing.md); no migration or mandatory
CMS reread is added. Nomia owns its `/pesquisa/?q=…&pagina=…` page and Site-only
header blocks; none are implemented in this repository or in global GQ Design.
