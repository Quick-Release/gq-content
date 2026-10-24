/// <reference types="node" />
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createContentRuntime } from "@getquick/content/server";
import { renderDesignPattern } from "@getquick/content";
import { designPostContext } from "@getquick/content";
import { openTestD1 } from "./support/sqlite-d1";
import { data, stubWordPress } from "./support/wordpress-stub";

// Verbatim producer snapshots: gq-design 6b5f746; publishedPost is never rewritten.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/query-composition/post-public.json", import.meta.url), "utf8"),
);
const config = {
  site: "Canonical",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  isServer: () => true,
};
function postAnswer(item = fixture.items[0], overrides = {}) {
  return data({
    postBy: {
      id: `post-${item.id}`,
      uri: fixture.blocks[0].attributes.items.find(
        (selected: { id: number }) => selected.id === item.id,
      ).uri,
      excerpt: "",
      content: "<p>Saved HTML</p>",
      date: null,
      status: "publish",
      isRestricted: false,
      featuredImage: null,
      ...item.publishedPost,
      ...overrides,
    },
    pageBy: null,
    designTokens: { colors: [], spacingSizes: [] },
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("the saved standard Post Query retains its producer-selected order and count", () => {
  const saved = readFileSync(
    new URL("./fixtures/query-composition/post-saved.html", import.meta.url),
    "utf8",
  );
  const authored = JSON.parse(saved.match(/<!-- wp:getquick-design\/query (\{.*\}) \/-->/)![1]);
  expect(authored).toEqual({
    patternId: 664,
    postType: "post",
    perPage: 2,
    orderBy: "title",
    order: "asc",
    offset: 1,
  });
  expect(fixture.blocks[0].attributes).toMatchObject(authored);
  expect(fixture.blocks[0].attributes.items.map((item: { uri: string }) => item.uri)).toEqual([
    "/00081-beta/",
    "/00081-gamma/",
  ]);
});

test("loads the producer's canonical Post tree through the existing URI read", async () => {
  stubWordPress({ entry: () => postAnswer() });
  const result = await createContentRuntime({
    ...config,
    bindings: () => ({}),
  }).wordpress.getEntryByUri("/00081-beta/");
  expect(result).toMatchObject({
    kind: "found",
    content: {
      databaseId: fixture.items[0].publishedPost.databaseId,
      designBlocks: JSON.parse(fixture.items[0].publishedPost.getquickBlocksJson),
    },
  });
});

test("stored offline Posts feed preload and repeat the exact producer selection once", async () => {
  const db = openTestD1();
  try {
    await db
      .prepare(
        "INSERT INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES ('chrome','published',1,?,1,1)",
      )
      .bind(
        JSON.stringify({
          menuItems: [],
          siteIcon: null,
          siteLogo: null,
          header: null,
          footer: null,
        }),
      )
      .run();
    stubWordPress({
      entry: ({ uri }) =>
        postAnswer(
          fixture.items.find(
            (item: { id: number }) =>
              fixture.blocks[0].attributes.items.find(
                (selected: { id: number; uri: string }) => selected.id === item.id,
              ).uri === uri,
          ),
        ),
    });
    const online = createContentRuntime({
      ...config,
      bindings: () => ({ PUBLICATION_DB: db }),
    });
    for (const item of fixture.blocks[0].attributes.items) {
      const result = await online.publishedEntry(item.uri);
      expect(result.kind).toBe("found");
    }
    const offlineFetch = vi.fn(() => {
      throw new Error("CMS offline");
    });
    const offline = createContentRuntime({
      ...config,
      bindings: () => ({ PUBLICATION_DB: db }),
      fetch: offlineFetch,
    });
    const result = await offline.publishedEntry("/00081-beta/");
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("Expected stored Post");
    expect(designPostContext(result.content.entry)).toMatchObject({
      id: 662,
      title: "00081 Beta",
      blocks: JSON.parse(fixture.items[0].publishedPost.getquickBlocksJson),
    });
    const contexts = await offline.preloadDesignQueryPosts(fixture.blocks);
    const html = renderDesignPattern(fixture.blocks, contexts);
    expect(html.match(/<h2\b/g)).toHaveLength(2);
    expect(html.match(/00081 Beta content/g)).toHaveLength(1);
    expect(html.match(/00081 Gamma content/g)).toHaveLength(1);
    expect(html.indexOf("00081 Beta content")).toBeLessThan(html.indexOf("00081 Gamma content"));
    expect(html.match(/Nested item body/g)).toHaveLength(2);
    expect(html.match(/Pattern details/g)).toHaveLength(2);
    expect(offlineFetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test("a malformed supplied canonical list fails a standard Post read on a Site with collections", async () => {
  const answer = postAnswer(fixture.items[0], {
    getquickBlocksJson: '[{"name":"core/paragraph"}]',
  });
  stubWordPress({
    entry: async () => {
      const result = await (
        answer as { json: () => Promise<{ data: { postBy: unknown; designTokens: unknown } }> }
      ).json();
      return data({
        node: { __typename: "Post", ...(result.data.postBy as object) },
        designTokens: result.data.designTokens,
      });
    },
  });
  const result = await createContentRuntime({
    ...config,
    bindings: () => ({}),
    collections: { books: { postType: "book", graphqlType: "Book" } },
  }).wordpress.getEntryByUri("/00081-beta/");
  expect(result).toMatchObject({ kind: "unavailable", failure: { reason: "schema" } });
});

test("old CMS compatibility removes only the unavailable canonical field and keeps Site extensions", async () => {
  const requests: string[] = [];
  stubWordPress({
    entry: (_variables, query) => {
      requests.push(query!);
      return requests.length === 1
        ? {
            ok: true,
            json: async () => ({
              errors: [
                { message: 'Cannot query field "getquickBlocksJson" on type "Post".' },
                { message: 'Cannot query field "getquickBlocksJson" on type "Page".' },
              ],
            }),
          }
        : postAnswer(fixture.items[0], { getquickBlocksJson: undefined, siteLabel: "Kept" });
    },
  });
  const result = await createContentRuntime({
    ...config,
    bindings: () => ({}),
    extension: {
      fields: { post: "siteLabel", page: "siteLabel" },
      read: (node) => node.fields.siteLabel,
      parse: (value) => (typeof value === "string" ? value : undefined),
    },
  }).wordpress.getEntryByUri("/00081-beta/");
  expect(result).toMatchObject({
    kind: "found",
    content: { extension: "Kept", blocksOmitted: false },
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toContain("getquickBlocksJson @include(if: $withBlocks)");
  expect(requests[1]).toBe(
    requests[0].replace(/getquickBlocksJson @include\(if: \$withBlocks\)/g, ""),
  );
  expect(requests[1]).toContain("blocks(attributes: true");
  expect(requests[1]).toContain("siteLabel");
});

test.each([
  ['Cannot query field "getquickBlocksJson" on type "Post".', "Permission denied"],
  ['Cannot query field "blocks" on type "Post".'],
  ['Cannot query field "getquickBlocksJsonExtra" on type "Post".'],
])("other GraphQL errors never downgrade the entry query: %j", async (...messages) => {
  const fetch = stubWordPress({
    entry: () => ({
      ok: true,
      json: async () => ({ errors: messages.map((message) => ({ message })) }),
    }),
  });
  const result = await createContentRuntime({
    ...config,
    bindings: () => ({}),
  }).wordpress.getEntryByUri("/00081-beta/");
  expect(result).toMatchObject({ kind: "unavailable", failure: { reason: "graphql" } });
  expect(fetch).toHaveBeenCalledOnce();
});

test.each([undefined, null])(
  "an absent or null canonical field still serves legacy Post HTML (%j)",
  async (value) => {
    stubWordPress({
      entry: () =>
        postAnswer(fixture.items[0], { databaseId: undefined, getquickBlocksJson: value }),
    });
    const result = await createContentRuntime({
      ...config,
      bindings: () => ({}),
    }).wordpress.getEntryByUri("/00081-beta/");
    expect(result).toMatchObject({ kind: "found", content: { content: "<p>Saved HTML</p>" } });
    if (result.kind !== "found") throw new Error("Expected legacy Post");
    expect(result.content).not.toHaveProperty("designBlocks");
    expect(result.content).not.toHaveProperty("databaseId");
  },
);

test.each([
  "{",
  "{}",
  '[{"name":"core/paragraph"}]',
  '[{"name":"core/paragraph","attributes":{},"content":null,"children":[],"unexpected":true}]',
])("bad canonical JSON never silently becomes a legacy HTML Post: %s", async (json) => {
  stubWordPress({ entry: () => postAnswer(fixture.items[0], { getquickBlocksJson: json }) });
  const result = await createContentRuntime({
    ...config,
    bindings: () => ({}),
  }).wordpress.getEntryByUri("/00081-beta/");
  expect(result).toMatchObject({ kind: "unavailable", failure: { reason: "schema" } });
});

test("home carries the same canonical Page tree and database identity", async () => {
  stubWordPress({
    home: (_variables, query) => {
      expect(query).toContain("databaseId");
      expect(query).toContain("getquickBlocksJson @include(if: $withBlocks)");
      return data({
        generalSettings: { title: "Canonical", description: "" },
        nodeByUri: {
          __typename: "Page",
          id: "page-662",
          isFrontPage: true,
          content: "<p>Saved home</p>",
          ...fixture.items[0].publishedPost,
        },
        designTokens: { colors: [], spacingSizes: [] },
      });
    },
  });
  const result = await createContentRuntime({
    ...config,
    bindings: () => ({}),
  }).wordpress.getHomeContent();
  expect(result).toMatchObject({
    kind: "found",
    content: {
      page: {
        databaseId: 662,
        designBlocks: JSON.parse(fixture.items[0].publishedPost.getquickBlocksJson),
      },
    },
  });
});

test("canonical field compatibility still recovers an HTTP 500 by omitting blocks", async () => {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
  stubWordPress({
    entry: (variables, query) => {
      requests.push({ query: query!, variables });
      if (requests.length === 1)
        return {
          ok: true,
          json: async () => ({
            errors: [{ message: 'Cannot query field "getquickBlocksJson" on type "Post".' }],
          }),
        };
      if (variables.withBlocks !== false) return { ok: false, status: 500 };
      return postAnswer(fixture.items[0], { getquickBlocksJson: undefined });
    },
  });
  const result = await createContentRuntime({
    ...config,
    bindings: () => ({}),
  }).wordpress.getEntryByUri("/00081-beta/");
  expect(result).toMatchObject({ kind: "found", content: { blocksOmitted: true } });
  expect(requests).toHaveLength(3);
  expect(requests[2].query).not.toContain("getquickBlocksJson");
});

test.each(["entry", "home"])(
  "stored %s rows validate canonical trees and retain old optional-field compatibility",
  async (kind) => {
    const db = openTestD1();
    try {
      const chrome = { menuItems: [], siteIcon: null, siteLogo: null, header: null, footer: null };
      const entry = {
        id: "post-662",
        title: "00081 Beta",
        excerpt: "",
        content: "<p>Saved HTML</p>",
        uri: "/00081-beta/",
        date: "",
        featuredImage: null,
        hasVideoHero: false,
        spacingSizes: [],
        colors: [],
      };
      const home = {
        settings: { title: "Canonical", description: "" },
        page: { title: "Home", content: "<p>Home</p>", hasVideoHero: false },
        spacingSizes: [],
        colors: [],
      };
      const key = kind === "entry" ? "entry:/00081-beta/" : "home";
      async function seed(key: string, body: unknown) {
        await db
          .prepare(
            "INSERT OR REPLACE INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES (?,'published',1,?,1,1)",
          )
          .bind(key, JSON.stringify(body))
          .run();
      }
      await seed("chrome", chrome);
      const fetch = vi.fn(() => {
        throw new Error("CMS offline");
      });
      const runtime = createContentRuntime({
        ...config,
        bindings: () => ({ PUBLICATION_DB: db }),
        fetch,
      });
      const read = () =>
        kind === "entry" ? runtime.publishedEntry("/00081-beta/") : runtime.publishedHome();
      const body = kind === "entry" ? entry : home;
      await seed(key, body);
      expect((await read()).kind).toBe("found");
      const fields = {
        databaseId: 662,
        designBlocks: JSON.parse(fixture.items[0].publishedPost.getquickBlocksJson),
      };
      await seed(
        key,
        kind === "entry" ? { ...entry, ...fields } : { ...home, page: { ...home.page, ...fields } },
      );
      const valid = await read();
      expect(valid).toMatchObject(
        kind === "entry"
          ? { kind: "found", content: { entry: fields } }
          : { kind: "found", content: { home: { page: fields } } },
      );
      const invalid = { ...fields, designBlocks: [{ name: "core/paragraph" }] };
      await seed(
        key,
        kind === "entry"
          ? { ...entry, ...invalid }
          : { ...home, page: { ...home.page, ...invalid } },
      );
      expect(await read()).toMatchObject({ kind: "unavailable", failure: { reason: "not-ready" } });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  },
);
