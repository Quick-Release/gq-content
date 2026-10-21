import { expect, test, vi } from "vite-plus/test";
import { createContentRuntime } from "@getquick/content/server";

test("a browser read fails before loading bindings or invoking transport", async () => {
  const bindings = vi.fn(() => ({}));
  const fetch = vi.fn();
  const runtime = createContentRuntime({
    site: " Site Identity / 1 ",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => false,
    bindings,
    fetch,
  });
  expect((await runtime.wordpress.getPublishedRoutes()).kind).toBe("unavailable");
  expect(bindings).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("long-lived clients read fresh bindings and never expose credentials", async () => {
  let generation = "first";
  const fetch = vi.fn(async (_url, init) => {
    expect(new Headers(init?.headers).get("CF-Access-Client-Id")).toBe(generation);
    return Response.json({
      data: { contentNodes: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    });
  });
  const input = {
    site: " Identity / with spaces ",
    graphqlEndpoint: "https://cms.test/wp/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({
      GQ_AUTH_GRAPHQL_CLIENT_ID: generation,
      GQ_AUTH_GRAPHQL_CLIENT_SECRET: "secret",
    }),
    fetch,
  };
  const runtime = createContentRuntime(input);
  expect(await runtime.wordpress.getPublishedRoutes()).toEqual({ kind: "found", content: [] });
  generation = "second";
  expect(await runtime.wordpress.getPublishedRoutes()).toEqual({ kind: "found", content: [] });
  expect(JSON.stringify(runtime)).not.toContain("secret");
  expect(() => createContentRuntime({ ...input, site: " \n " })).toThrow("nonempty");
});

test("two instances retain independent configuration and canonical language identities", async () => {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (url) => {
    calls.push(url instanceof Request ? url.url : url.toString());
    return Response.json({
      data: { contentNodes: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    });
  };
  const config = {
    site: "One",
    graphqlEndpoint: "https://one.test/graphql",
    cmsOrigin: "https://one.test",
    wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
    isServer: () => true,
    bindings: () => ({}),
    fetch,
  };
  const one = createContentRuntime(config);
  const two = createContentRuntime({
    ...config,
    site: "Two",
    graphqlEndpoint: "https://two.test/graphql",
    cmsOrigin: "https://two.test",
    wordpress: { locale: "ja" },
  });
  config.wordpress.languages[0]!.slug = "changed";
  expect(one.defaultLanguage).toBe(one.languages[0]);
  expect(one.routeLanguage("/en/about/")).toBe(one.languages[1]);
  expect(one.routeLanguage("/")).toBe(one.defaultLanguage);
  expect(one.isLanguageHome("/en/")).toBe(true);
  expect(one.multilingual).toBe(true);
  expect(two.multilingual).toBe(false);
  expect(two.defaultLanguage.lang).toBe("ja");
  expect(one.defaultLanguage).not.toBe(two.defaultLanguage);
  await one.wordpress.getPublishedRoutes();
  await two.wordpress.getPublishedRoutes();
  expect(calls).toEqual(["https://one.test/graphql", "https://two.test/graphql"]);
});

test("the configured transport has an eight second deadline", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    throw new DOMException("private transport detail", "TimeoutError");
  };
  const runtime = createContentRuntime({
    site: "Timeout",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({}),
    fetch,
  });
  expect(await runtime.wordpress.getPublishedRoutes()).toEqual({
    kind: "unavailable",
    failure: { reason: "timeout", message: "WordPress didn't answer within 8 seconds" },
  });
  expect(timeout).toHaveBeenCalledWith(8000);
  timeout.mockRestore();
});

test("upstream error messages cannot echo configured credentials into results or logs", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const runtime = createContentRuntime({
    site: "Errors",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({
      GQ_AUTH_GRAPHQL_CLIENT_ID: "sensitive-client",
      GQ_AUTH_GRAPHQL_CLIENT_SECRET: "sensitive-secret",
    }),
    fetch: async () =>
      Response.json({ errors: [{ message: "rejected sensitive-client sensitive-secret" }] }),
  });
  const result = await runtime.wordpress.getPublishedRoutes();
  expect(result.kind).toBe("unavailable");
  expect(JSON.stringify([result, log.mock.calls])).not.toContain("sensitive-");
  log.mockRestore();
});

test.each([{ errors: [null] }, { errors: "not-an-array" }, { errors: [{}] }])(
  "a malformed GraphQL error envelope fails safely: %j",
  async (body) => {
    const runtime = createContentRuntime({
      site: "Envelope",
      graphqlEndpoint: "https://cms.test/graphql",
      cmsOrigin: "https://cms.test",
      isServer: () => true,
      bindings: () => ({}),
      fetch: async () => Response.json(body),
    });
    expect(await runtime.wordpress.getPublishedRoutes()).toMatchObject({
      kind: "unavailable",
      failure: { reason: "schema" },
    });
  },
);

test("configured languages select the language-specific home and chrome without changing argument order", async () => {
  const requests: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const runtime = createContentRuntime({
    site: "Languages",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
    isServer: () => true,
    bindings: () => ({}),
    fetch: async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON body");
      const request = JSON.parse(init.body) as {
        query: string;
        variables?: Record<string, unknown>;
      };
      requests.push(request);
      if (request.query.includes("SiteChrome"))
        return Response.json({
          data: {
            generalSettings: { siteIcon: null, siteLogo: null },
            menuItems: {
              nodes: [
                {
                  id: "home",
                  parentId: null,
                  label: "Home",
                  url: "https://site.test/en/",
                  target: null,
                },
              ],
            },
            header: null,
            footer: null,
          },
        });
      return Response.json({
        data: {
          ...(request.variables?.language
            ? { language: { title: "English", description: "Things" } }
            : { generalSettings: { title: "Português", description: "Coisas" } }),
          nodeByUri: {
            __typename: "Page",
            isFrontPage: true,
            title: "Home",
            content: "<p>Home</p>",
          },
          designTokens: { colors: [], spacingSizes: [] },
        },
      });
    },
  });
  expect(await runtime.wordpress.getHomeContent()).toMatchObject({
    kind: "found",
    content: { settings: { title: "Português" } },
  });
  const english = runtime.routeLanguage("/en/");
  expect(english).toBe(runtime.languages[1]);
  expect(await runtime.wordpress.getHomeContent(english)).toMatchObject({
    kind: "found",
    content: { settings: { title: "English" } },
  });
  expect(
    await runtime.wordpress.getSiteChrome("https://site.test", {
      location: "FOOTER",
      language: english,
    }),
  ).toMatchObject({ kind: "found", content: { menuItems: [{ href: "/en/" }] } });
  expect(requests.map((request) => request.variables)).toEqual([
    {},
    { uri: "/en/", language: "EN" },
    { location: "FOOTER", template: "page", language: "EN" },
  ]);
});
