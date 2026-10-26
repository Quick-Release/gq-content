// Form descriptors delivered with publications (ADR 0009): a Site that opts
// in to `forms` reads each entry's `getquickForms` with its blocks, stores the
// descriptors with it, serves them through CMS outages and finds them for the
// form endpoint (`publishedForm`). Without the option nothing changes.
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createContentRuntime } from "@getquick/content/server";
import { CONTACT_FORM } from "@getquick/content/forms/testing";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import { data, queries, routes, stubWordPress, type Handler } from "./support/wordpress-stub";

let db: TestD1;
const token = "forms-delivery-token-01234567890123456789012345678";
const config = {
  site: "Acme",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  isServer: () => true,
  bindings: () => ({ PUBLICATION_DB: db, FRONTEND_REFRESH_TOKEN: token }),
};
const presets = { colors: [], spacingSizes: [] };
const delivered = JSON.stringify([{ ...CONTACT_FORM, notifications: [{ to: "admin@acme.test" }] }]);

let formsField: string | null | undefined;
const page = (uri: string, fields: Record<string, unknown> = {}) => ({
  id: `page:${uri}`,
  uri,
  title: "Contactos",
  content: "",
  status: "publish",
  isRestricted: false,
  featuredImage: null,
  ...fields,
});
const home: Handler = (_variables, query) =>
  data({
    generalSettings: { title: "Acme", description: "" },
    nodeByUri: {
      __typename: "Page",
      id: "front",
      isFrontPage: true,
      title: "Home",
      content: "",
      ...(query?.includes("getquickForms") ? { getquickForms: formsField } : {}),
    },
    designTokens: presets,
  });
const entry: Handler = ({ uri }, query) =>
  data({
    postBy: null,
    pageBy: page(
      String(uri),
      query?.includes("getquickForms") ? { getquickForms: formsField } : {},
    ),
    designTokens: presets,
  });
const wordpress = (overrides: Parameters<typeof stubWordPress>[0] = {}) =>
  stubWordPress({ home, entry, routes: () => routes("/", "/contactos/"), ...overrides });

async function refresh(runtime: ReturnType<typeof createContentRuntime>) {
  const response = await runtime.handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}",
    }),
    { siteOrigin: "https://site.test" },
  );
  return response.json();
}

beforeEach(() => {
  db = openTestD1();
  formsField = delivered;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("without `forms`, reads are unchanged and nothing is stored or found", async () => {
  const fetch = wordpress();
  const runtime = createContentRuntime(config);
  await runtime.wordpress.getHomeContent();
  await runtime.wordpress.getEntryByUri("/contactos/");
  for (const [, init] of fetch.mock.calls)
    expect(init.body as string).not.toContain("getquickForms");
  await refresh(runtime);
  const found = await runtime.publishedEntry("/contactos/");
  expect(found.kind === "found" && "forms" in found.content.entry).toBe(false);
  expect(await runtime.publishedForm("/contactos/", 1)).toBeNull();
});

test("with `forms`, each entry's descriptors are read with its blocks, stored, and served through an outage", async () => {
  const fetch = wordpress();
  const runtime = createContentRuntime({ ...config, forms: true });
  const read = await runtime.wordpress.getEntryByUri("/contactos/");
  expect(read.kind === "found" && read.content.forms).toEqual([CONTACT_FORM]);
  const [entryQuery] = queries(fetch, "EntryByUri");
  expect(entryQuery![1].body as string).toContain("getquickForms @include(if: $withBlocks)");
  expect(await refresh(runtime)).toMatchObject({ ready: true });

  fetch.mockImplementation(async () => {
    throw new Error("CMS offline");
  });
  const served = await runtime.publishedEntry("/contactos/");
  if (served.kind !== "found") throw new Error(served.kind);
  // Only the descriptor's public fields were stored.
  expect(served.content.entry.forms).toEqual([CONTACT_FORM]);
  expect(JSON.stringify(served.content.entry)).not.toContain("notifications");
  expect(await runtime.publishedForm("/contactos/", 1)).toEqual(CONTACT_FORM);
  expect(await runtime.publishedForm("/contactos/?x=1", 1)).toEqual(CONTACT_FORM);
  expect(await runtime.publishedForm("/contactos/", 2)).toBeNull();
  expect(await runtime.publishedForm("/", 1)).toEqual(CONTACT_FORM);
});

test("a CMS whose forms module is dormant (no Gravity Forms) is read without the field", async () => {
  const fetch = wordpress({
    entry: (variables, query) =>
      query?.includes("getquickForms")
        ? {
            ok: true,
            json: async () => ({
              errors: [{ message: 'Cannot query field "getquickForms" on type "Page".' }],
            }),
          }
        : entry(variables, query),
  });
  const runtime = createContentRuntime({ ...config, forms: true });
  const read = await runtime.wordpress.getEntryByUri("/contactos/");
  expect(read).toMatchObject({ kind: "found", content: { uri: "/contactos/" } });
  expect(read.kind === "found" && "forms" in read.content).toBe(false);
  expect(queries(fetch, "EntryByUri")).toHaveLength(2);
});

test("an entry without forms stores none, and null from the CMS means none", async () => {
  formsField = "[]";
  wordpress();
  const runtime = createContentRuntime({ ...config, forms: true });
  const read = await runtime.wordpress.getEntryByUri("/contactos/");
  expect(read.kind === "found" && read.content.forms).toEqual([]);
  formsField = null;
  const none = await runtime.wordpress.getEntryByUri("/contactos/");
  expect(none.kind === "found" && "forms" in none.content).toBe(false);
});

test("a CMS found without getquickForms isn't asked for it again", async () => {
  const fetch = wordpress({
    entry: (variables, query) =>
      query?.includes("getquickForms")
        ? {
            ok: true,
            json: async () => ({
              errors: [{ message: 'Cannot query field "getquickForms" on type "Page".' }],
            }),
          }
        : entry(variables, query),
  });
  const runtime = createContentRuntime({ ...config, forms: true });
  await runtime.wordpress.getEntryByUri("/contactos/");
  await runtime.wordpress.getEntryByUri("/contactos/");
  expect(queries(fetch, "EntryByUri")).toHaveLength(3);
});

test("a language home posted without its trailing slash finds its form", async () => {
  // Live reads (development, no store): the English home is read as a home.
  const fetch = wordpress({
    home: (variables, query) =>
      data({
        generalSettings: { title: "Acme", description: "" },
        language: { title: "Acme", description: "" },
        nodeByUri: {
          __typename: "Page",
          id: `front:${JSON.stringify(variables.uri ?? "/")}`,
          isFrontPage: true,
          title: "Home",
          content: "",
          ...(query?.includes("getquickForms") ? { getquickForms: formsField } : {}),
        },
        designTokens: presets,
      }),
  });
  const runtime = createContentRuntime({
    ...config,
    development: true,
    bindings: () => ({}),
    forms: true,
    wordpress: { locale: "pt_PT", languages: [{ locale: "en_GB", slug: "en" }] },
  });
  expect(await runtime.publishedForm("/en", 1)).toEqual(CONTACT_FORM);
  expect(queries(fetch, "HomePage").length).toBeGreaterThan(0);
  expect(queries(fetch, "EntryByUri")).toHaveLength(0);
});
