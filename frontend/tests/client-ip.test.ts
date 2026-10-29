// The client IP behind a Site's own reverse proxy (#54): `trustedProxies` on
// the form and consent endpoints, through what their rate limiters and
// Turnstile are given. A proxy is believed only when CF-Connecting-IP is one.
import { expect, test } from "vite-plus/test";
import { createConsentServer } from "@getquick/content/consent/server";
import { createFormsServer, TURNSTILE_SITEVERIFY_URL } from "@getquick/content/forms/server";
import { CONTACT_FORM, contactSubmission, formBody } from "@getquick/content/forms/testing";

const SITE = "https://www.acme.test";
// nomia-bnq's proxy in front of bioeconomia.apambiente.pt.
const PROXIES = ["2.31.143.228", "2a01:4f8:c016:e5cd::/64"];

/** The keys the form and consent rate limiters see, and Turnstile's remoteip, for one request's headers. */
async function seen(headers: Record<string, string>, trustedProxies?: readonly string[]) {
  const keys: string[] = [];
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: false };
    },
  };
  const consent = createConsentServer({
    siteId: "acme",
    bindings: () => ({ CONSENT_RATE_LIMITER: limiter }),
    ...(trustedProxies ? { trustedProxies } : {}),
  });
  const consentResponse = await consent.handle(
    new Request(`${SITE}/gq/consent`, {
      method: "POST",
      headers: {
        Origin: SITE,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
        ...headers,
      },
      body: "{}",
    }),
  );
  expect(consentResponse?.status).toBe(429);

  const formPost = () =>
    new Request(`${SITE}/gq/forms/1`, {
      method: "POST",
      headers: {
        Origin: SITE,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: formBody({ ...contactSubmission(), "cf-turnstile-response": "token" }),
    });
  const limited = createFormsServer({
    cmsOrigin: "https://cms.acme.test",
    descriptor: () => CONTACT_FORM,
    bindings: () => ({ FORMS_RATE_LIMITER: limiter }),
    ...(trustedProxies ? { trustedProxies } : {}),
  });
  await limited.handle(formPost());

  let remoteip: string | null = null;
  const verified = createFormsServer({
    cmsOrigin: "https://cms.acme.test",
    descriptor: () => CONTACT_FORM,
    spam: { turnstile: true },
    bindings: () => ({ TURNSTILE_SECRET_KEY: "secret" }),
    ...(trustedProxies ? { trustedProxies } : {}),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(TURNSTILE_SITEVERIFY_URL);
      remoteip = new URLSearchParams(await request.text()).get("remoteip");
      return Response.json({ success: false });
    },
  });
  await verified.handle(formPost());

  const [consentKey, formKey] = keys;
  expect(formKey).toBe(`1:${consentKey}`);
  return { key: consentKey, remoteip };
}

test("without trustedProxies, CF-Connecting-IP is the client and forwarding headers are ignored", async () => {
  expect(
    await seen({
      "CF-Connecting-IP": "2.31.143.228",
      "X-Forwarded-For": "198.51.100.7",
      "X-Real-IP": "198.51.100.7",
    }),
  ).toEqual({ key: "2.31.143.228", remoteip: "2.31.143.228" });
  expect(await seen({})).toEqual({ key: "unknown", remoteip: null });
});

test("a trusted IPv4 proxy's X-Forwarded-For names the client", async () => {
  expect(
    await seen({ "CF-Connecting-IP": "2.31.143.228", "X-Forwarded-For": "198.51.100.7" }, PROXIES),
  ).toEqual({ key: "198.51.100.7", remoteip: "198.51.100.7" });
});

test("a trusted IPv6 proxy, anywhere in its /64, is believed; X-Real-IP when there is no X-Forwarded-For", async () => {
  expect(
    await seen(
      { "CF-Connecting-IP": "2a01:4f8:c016:e5cd::2", "X-Real-IP": "198.51.100.8" },
      PROXIES,
    ),
  ).toEqual({ key: "198.51.100.8", remoteip: "198.51.100.8" });
  expect(
    await seen(
      { "CF-Connecting-IP": "2a01:4f8:c016:e5cd:ffff:1:2:3", "X-Forwarded-For": "198.51.100.9" },
      PROXIES,
    ),
  ).toEqual({ key: "198.51.100.9", remoteip: "198.51.100.9" });
});

test("forwarding headers from a source that isn't a trusted proxy are never believed", async () => {
  for (const peer of ["203.0.113.5", "2.31.143.229", "2a01:4f8:c016:e5ce::1"])
    expect(
      await seen(
        {
          "CF-Connecting-IP": peer,
          "X-Forwarded-For": "198.51.100.7",
          "X-Real-IP": "198.51.100.7",
        },
        PROXIES,
      ),
    ).toEqual({
      key: peer.includes(":") ? "2a01:4f8:c016:e5ce::/64" : peer,
      remoteip: peer,
    });
});

test("a spoofed X-Forwarded-For prefix is skipped: the right-most untrusted entry is the client", async () => {
  // The visitor sent "X-Forwarded-For: 192.0.2.1"; a proxy that appends adds the real address.
  expect(
    await seen(
      { "CF-Connecting-IP": "2.31.143.228", "X-Forwarded-For": "192.0.2.1, 198.51.100.7" },
      PROXIES,
    ),
  ).toEqual({ key: "198.51.100.7", remoteip: "198.51.100.7" });
  // Trusted hops (a chain of the Site's own proxies) are walked past.
  expect(
    await seen(
      {
        "CF-Connecting-IP": "2.31.143.228",
        "X-Forwarded-For": "192.0.2.1, 198.51.100.7, 2a01:4f8:c016:e5cd::9",
      },
      PROXIES,
    ),
  ).toEqual({ key: "198.51.100.7", remoteip: "198.51.100.7" });
  // An entry that isn't an address ends the walk: the proxy is the client.
  expect(
    await seen(
      { "CF-Connecting-IP": "2.31.143.228", "X-Forwarded-For": "198.51.100.7, unknown" },
      PROXIES,
    ),
  ).toEqual({ key: "2.31.143.228", remoteip: "2.31.143.228" });
  // Nothing forwarded, or a trusted address: the proxy is the client.
  expect(await seen({ "CF-Connecting-IP": "2.31.143.228" }, PROXIES)).toEqual({
    key: "2.31.143.228",
    remoteip: "2.31.143.228",
  });
  expect(
    await seen({ "CF-Connecting-IP": "2.31.143.228", "X-Real-IP": "2.31.143.228" }, PROXIES),
  ).toEqual({ key: "2.31.143.228", remoteip: "2.31.143.228" });
});

test("IPv6 clients behind the proxy are rate limited by /64; Turnstile gets the address", async () => {
  const first = await seen(
    { "CF-Connecting-IP": "2.31.143.228", "X-Forwarded-For": "2001:DB8:1:2:aaaa::1" },
    PROXIES,
  );
  const second = await seen(
    { "CF-Connecting-IP": "2.31.143.228", "X-Forwarded-For": "[2001:db8:1:2:bbbb::2]:51234" },
    PROXIES,
  );
  const other = await seen(
    { "CF-Connecting-IP": "2.31.143.228", "X-Forwarded-For": "2001:db8:1:3::1" },
    PROXIES,
  );
  expect(first).toEqual({ key: "2001:db8:1:2::/64", remoteip: "2001:db8:1:2:aaaa::1" });
  expect(second).toEqual({ key: "2001:db8:1:2::/64", remoteip: "2001:db8:1:2:bbbb::2" });
  expect(other.key).toBe("2001:db8:1:3::/64");
  // Direct IPv6 visitors too, and an IPv4-mapped address is its IPv4.
  expect(await seen({ "CF-Connecting-IP": "2001:db8:0:0:1::5" })).toEqual({
    key: "2001:db8::/64",
    remoteip: "2001:db8::1:0:0:5",
  });
  expect(
    await seen(
      { "CF-Connecting-IP": "2.31.143.228", "X-Forwarded-For": "::ffff:198.51.100.7" },
      PROXIES,
    ),
  ).toEqual({ key: "198.51.100.7", remoteip: "198.51.100.7" });
});

test("an invalid trustedProxies entry, or one trusting everyone, fails at configuration", () => {
  for (const entry of [
    "2.31.143",
    "2.31.143.228/33",
    "2a01:4f8::/129",
    "0.0.0.0/0",
    "::/0",
    "proxy",
  ]) {
    expect(() =>
      createConsentServer({ siteId: "acme", bindings: () => ({}), trustedProxies: [entry] }),
    ).toThrow(/trustedProxies/);
    expect(() =>
      createFormsServer({
        cmsOrigin: "https://cms.acme.test",
        descriptor: () => null,
        bindings: () => ({}),
        trustedProxies: [entry],
      }),
    ).toThrow(/trustedProxies/);
  }
});
