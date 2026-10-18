# @getquick/content

The configured content runtime for WordPress HTML and WPGraphQL. This slice
provides pure helpers and the configured WordPress client. Publication delivery,
migrations and HTTP handlers arrive in subsequent extraction issues; this is not
a completed or published 0.1.0 release pair.

```ts
import { renderWordPressBlocks, htmlLang } from "@getquick/content";
import { createContentRuntime } from "@getquick/content/server";

const content = createContentRuntime({
  site: "my Site identity",
  graphqlEndpoint: "https://cms.example.test/wp/graphql",
  cmsOrigin: "https://cms.example.test",
  wordpress: {
    locale: "pt_PT_ao90",
    languages: [{ locale: "en_US", slug: "en" }],
  },
  isServer: () => true, // Supply the framework's lazy server-context check.
  bindings: () => ({}), // Supply fresh request bindings, including optional credentials.
});
const home = await content.wordpress.getHomeContent(content.defaultLanguage);
const entry = await content.wordpress.getEntryByUri("/about/");
const chrome = await content.wordpress.getSiteChrome("https://www.example.test", {
  language: content.routeLanguage("/en/about/"),
});
```

The Site supplies all configuration: no manifest, framework environment or
Cloudflare discovery is imported. Construct per request where practical. A
long-lived instance calls its binding getter on every CMS request. Keep the
GraphQL read identity separate from automation identities. Partial credential
pairs fail before transport. With credentials, only the configured HTTPS CMS
origin at `/graphql` or `/wp/graphql`, without URL userinfo, is allowed. Reads use
manual redirects and an eight-second deadline; failed reads return unavailable,
confirmed absence returns missing, and successful reads return found.

The root entry contains pure helpers and public structural types. The server
entry exports `createContentRuntime`, `ContentConfig`, `ContentBindings`,
`ContentRuntime` and `WordPressClient`. Runtime properties contain languages,
routing functions and the WordPress methods; credentials/configuration are kept
in closures. Language configuration retains the source's normalization policy,
and routing returns the same language objects held in that instance's array.

The reusable client methods retain their argument order:

- `getHomeContent(language?)`
- `getEntryByUri(uri)`
- `getDesignPresets()`
- `getPublishedEntries()`
- `getPublishedRoutes()`
- `getSiteChrome(siteOrigin?, { location?, language? }?)`

From the repository root, use `vp install` and `vp run validate`. Validation
builds compiled ESM/declarations through Vite+ Pack, checks formatting/lint/types,
runs package-boundary suites, then packs and installs in a disposable consumer
without private registry configuration. `vp run test` rebuilds before tests;
`vp test frontend/tests/wordpress-access.test.ts` is useful after an explicit
`vp pack` during a focused implementation cycle. Build output is intentionally
untracked. The npm tarball allowlist contains only compiled output and package
metadata (npm also includes this README).
