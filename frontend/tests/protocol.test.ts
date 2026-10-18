import { expect, test } from "vite-plus/test";
import { createContentRuntime } from "@getquick/content/server";

test("standard handlers reject other methods without bindings or CMS access", async () => {
  const runtime = createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => {
      throw new Error("must not bind");
    },
  });
  for (const [handler, message] of [
    [runtime.handleEvent, "Deliver events with POST."],
    [runtime.handleRefresh, "Refresh with POST."],
  ] as const) {
    const response = await handler(new Request("https://site.test/gq/events"));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: message });
  }
});

import { createHmac } from "node:crypto";
import { openTestD1 } from "./support/sqlite-d1";
const secret = "local-signing-key-012345678901234567890123456789";
function signed(event: unknown) {
  const body = JSON.stringify(event),
    timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://site.test/gq/events", {
    method: "POST",
    body,
    headers: {
      "GQ-Event-Timestamp": timestamp,
      "GQ-Event-Signature":
        "v1=" +
        createHmac("sha256", secret)
          .update(timestamp + "." + body)
          .digest("hex"),
    },
  });
}
test("signed withdrawal immediately hides stored content while CMS is unavailable", async () => {
  const db = openTestD1();
  try {
    await db
      .prepare(
        "INSERT INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES ('chrome','published',1,?,1,1)",
      )
      .bind(JSON.stringify({ menuItems: [], siteIcon: null, siteLogo: null }))
      .run();
    const api = createContentRuntime({
      site: "Acme",
      graphqlEndpoint: "https://cms.test/graphql",
      cmsOrigin: "https://cms.test",
      isServer: () => true,
      bindings: () => ({ PUBLICATION_DB: db, PUBLICATION_EVENT_SECRET: secret }),
      fetch: async () => {
        throw new Error("CMS must not be read");
      },
    });
    const response = await api.handleEvent(
      signed({
        site: "Acme",
        id: "withdraw-0001",
        occurredAt: Date.now() - 1000,
        action: "withdraw",
        entry: { id: "page-1", uri: "/about/" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      event: "withdraw-0001",
      status: "withdrawn",
      withdrawn: ["/about/"],
    });
    expect((await api.publishedEntry("/about/")).kind).toBe("missing");
  } finally {
    db.close();
  }
});

import { vi } from "vite-plus/test";
import type { ContentBindings } from "@getquick/content/server";
const token = "refresh-token-012345678901234567890123456789";
function configured(
  bindings: () => ContentBindings,
  extra: Partial<Parameters<typeof createContentRuntime>[0]> = {},
) {
  return createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings,
    ...extra,
  });
}
function refreshRequest(body: string, authorization: string | null = `Bearer ${token}`) {
  return new Request("https://site.test/gq/refresh", {
    method: "POST",
    body,
    headers: authorization ? { Authorization: authorization } : {},
  });
}
test.each(["handleEvent", "handleRefresh"] as const)(
  "%s guards browser context before bindings or transport",
  async (method) => {
    const bindings = vi.fn(() => {
        throw new Error("private binding secret");
      }),
      fetch = vi.fn();
    const api = configured(bindings, { isServer: () => false, fetch });
    const result = await api[method](
      new Request("https://site.test/gq", { method: "POST", body: "invalid" }),
    );
    expect(result.status).toBe(403);
    expect(bindings).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);
test.each([undefined, "short"])(
  "handlers refuse absent or short credentials independently of stored reads: %s",
  async (credential) => {
    const db = openTestD1();
    const fetch = vi.fn();
    try {
      const bindings = {
        PUBLICATION_DB: db,
        PUBLICATION_EVENT_SECRET: credential,
        FRONTEND_REFRESH_TOKEN: credential,
      };
      const api = configured(() => bindings, { fetch });
      expect((await api.handleEvent(signed({}))).status).toBe(403);
      expect((await api.handleRefresh(refreshRequest("{}"))).status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  },
);
test.each([null, "Bearer other", token, "bearer " + token])(
  "refresh authorization precedes JSON parsing: %s",
  async (auth) => {
    const db = openTestD1(),
      fetch = vi.fn();
    try {
      const result = await configured(
        () => ({ PUBLICATION_DB: db, FRONTEND_REFRESH_TOKEN: token }),
        { fetch },
      ).handleRefresh(refreshRequest("{", auth));
      expect(result.status).toBe(401);
      expect(result.headers.get("WWW-Authenticate")).toBe('Bearer realm="gq-refresh"');
      expect(await result.json()).toEqual({
        error: "A refresh needs this Frontend's refresh token as a bearer token.",
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  },
);
test.each([
  ["{", "The request body isn't JSON."],
  ["null", "The request body must be a JSON object."],
  ["[]", "The request body must be a JSON object."],
  ['{"unexpected":true}', "Unknown field: unexpected."],
  ['{"uris":[]}', "uris must list 1 to 100 paths."],
  ['{"uris":true}', "uris must list 1 to 100 paths."],
  [JSON.stringify({ uris: Array(101).fill("/about/") }), "uris must list 1 to 100 paths."],
  ...[
    "https://other.test/",
    "//other.test/",
    "/about/?x",
    "/about/#x",
    "/white space/",
    null,
    "/" + "x".repeat(2048),
  ].map((uri) => [
    JSON.stringify({ uris: [uri] }),
    `uris must be paths such as /about/, not ${JSON.stringify(uri)}.`,
  ]),
  ['{"uris":["/"]}', "/ is the front page: refresh the whole Site for it."],
  ['{"uris":["/en/"]}', "/en/ is the en front page: refresh the whole Site for it."],
])("refresh validates body before transport: %s", async (body, message) => {
  const db = openTestD1(),
    fetch = vi.fn();
  try {
    const api = configured(() => ({ PUBLICATION_DB: db, FRONTEND_REFRESH_TOKEN: token }), {
      fetch,
      wordpress: { locale: "pt_PT", languages: [{ locale: "en_US", slug: "en" }] },
    });
    const result = await api.handleRefresh(refreshRequest(body!));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: message });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
test("event body cap precedes signature, signature precedes JSON, Site precedes action and schema", async () => {
  const db = openTestD1(),
    fetch = vi.fn();
  try {
    const api = configured(() => ({ PUBLICATION_DB: db, PUBLICATION_EVENT_SECRET: secret }), {
      fetch,
    });
    const cases: [Request, number, string][] = [
      [
        new Request("https://site.test", { method: "POST", body: "x".repeat(16385) }),
        413,
        "The event is too large.",
      ],
      [
        new Request("https://site.test", { method: "POST", body: "{" }),
        401,
        "An event needs a current signature with this Site's event secret.",
      ],
      [signed({ site: "other", action: "bogus" }), 403, "The event is for another Site."],
      [signed({ site: "Acme", action: "bogus" }), 422, 'Unsupported action: "bogus".'],
    ];
    for (const [request, status, error] of cases) {
      const response = await api.handleEvent(request);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
test("long-lived handlers acquire current bindings and keep Site configurations isolated", async () => {
  const db = openTestD1(),
    other = openTestD1();
  let current: ContentBindings = {};
  try {
    const api = configured(() => current);
    expect((await api.handleEvent(signed({}))).status).toBe(403);
    current = {
      PUBLICATION_DB: db,
      PUBLICATION_EVENT_SECRET: secret,
      FRONTEND_REFRESH_TOKEN: token,
    };
    const event = { site: "Acme", id: "check-event-0001", occurredAt: Date.now(), action: "check" };
    expect((await api.handleEvent(signed(event))).status).toBe(200);
    const second = configured(() => ({ PUBLICATION_DB: other, PUBLICATION_EVENT_SECRET: secret }), {
      site: "Other",
    });
    expect((await second.handleEvent(signed(event))).status).toBe(403);
    current = {
      PUBLICATION_DB: other,
      PUBLICATION_EVENT_SECRET: "changed-key-012345678901234567890123456789",
    };
    expect((await api.handleEvent(signed(event))).status).toBe(401);
    expect(Object.keys(api)).not.toEqual(
      expect.arrayContaining(["secret", "store", "refreshAuthority", "verifiedSignature"]),
    );
  } finally {
    db.close();
    other.close();
  }
});
test.each(["handleEvent", "handleRefresh"] as const)(
  "%s safely handles binding errors without exposing details",
  async (method) => {
    const fetch = vi.fn();
    const api = configured(
      () => {
        throw new Error("private-secret");
      },
      { fetch },
    );
    const result = await api[method](refreshRequest("{}"));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private-secret");
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("declared and actual UTF-8 event body sizes are capped at 16 KiB before authentication", async () => {
  const db = openTestD1(),
    fetch = vi.fn();
  try {
    const api = configured(() => ({ PUBLICATION_DB: db, PUBLICATION_EVENT_SECRET: secret }), {
      fetch,
    });
    for (const request of [
      new Request("https://site.test", {
        method: "POST",
        body: "{}",
        headers: { "Content-Length": "16385" },
      }),
      new Request("https://site.test", { method: "POST", body: "é".repeat(8193) }),
    ]) {
      const result = await api.handleEvent(request);
      expect(result.status).toBe(413);
      expect(await result.json()).toEqual({ error: "The event is too large." });
    }
    const exact = await api.handleEvent(
      new Request("https://site.test", { method: "POST", body: "é".repeat(8192) }),
    );
    expect(exact.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
test("both handlers require a bound store before body parsing or CMS access", async () => {
  const fetch = vi.fn();
  const api = configured(
    () => ({ PUBLICATION_EVENT_SECRET: secret, FRONTEND_REFRESH_TOKEN: token }),
    { fetch },
  );
  expect(await (await api.handleEvent(signed({}))).json()).toEqual({
    error: "Events are disabled: this Frontend has no publication store bound.",
  });
  expect(await (await api.handleRefresh(refreshRequest("{"))).json()).toEqual({
    error: "Refresh is disabled: this Frontend has no publication store bound.",
  });
  expect(fetch).not.toHaveBeenCalled();
});
test("refresh observes new credentials on a long-lived instance and never exposes private helpers", async () => {
  const db = openTestD1();
  let current = token;
  const fetch = vi.fn();
  try {
    const api = configured(() => ({ PUBLICATION_DB: db, FRONTEND_REFRESH_TOKEN: current }), {
      fetch,
    });
    expect((await api.handleRefresh(refreshRequest("{"))).status).toBe(400);
    current = "different-refresh-token-01234567890123456789";
    expect((await api.handleRefresh(refreshRequest("{"))).status).toBe(401);
    expect((await api.handleRefresh(refreshRequest("{", "Bearer " + current))).status).toBe(400);
    for (const key of [
      "secret",
      "token",
      "store",
      "refreshEntries",
      "refreshAuthority",
      "verifiedSignature",
      "applyPublication",
      "withdrawEntry",
    ])
      expect(Object.keys(api)).not.toContain(key);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
test("signed reconciliation reports unavailable without acknowledging unimplemented work", async () => {
  const db = openTestD1(),
    fetch = vi.fn();
  try {
    const api = configured(() => ({ PUBLICATION_DB: db, PUBLICATION_EVENT_SECRET: secret }), {
      fetch,
    });
    const result = await api.handleEvent(
      signed({ site: "Acme", id: "reconcile-0001", action: "reconcile", occurredAt: Date.now() }),
    );
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      event: "reconcile-0001",
      status: "failed",
      failure: { reason: "not-ready", message: "Reconciliation is not available." },
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test("invalid event and refresh requests never access the publication store", async () => {
  const db = openTestD1(),
    fetch = vi.fn();
  db.unavailable = true;
  try {
    const api = configured(
      () => ({
        PUBLICATION_DB: db,
        PUBLICATION_EVENT_SECRET: secret,
        FRONTEND_REFRESH_TOKEN: token,
      }),
      { fetch },
    );
    for (const [event, status] of [
      [{ site: "other", action: "publish" }, 403],
      [{ site: "Acme", action: "publish" }, 400],
      [{ site: "Acme", action: "unknown" }, 422],
      [
        {
          site: "Acme",
          id: "valid-event-0001",
          action: "publish",
          occurredAt: Date.now(),
          entry: { id: "page", uri: "//foreign.test/" },
        },
        400,
      ],
    ] as const) {
      expect((await api.handleEvent(signed(event))).status).toBe(status);
    }
    expect((await api.handleRefresh(refreshRequest("{"))).status).toBe(400);
    expect((await api.handleRefresh(refreshRequest("{}", "Bearer wrong"))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
