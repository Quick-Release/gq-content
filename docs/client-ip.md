# Client IP behind a Site's own reverse proxy

The Site's own endpoints on its Frontend Worker key their rate limits on the
visitor's address, and the form endpoint passes it to Turnstile:

| Endpoint              | Factory               | Uses the client IP for                                |
| --------------------- | --------------------- | ----------------------------------------------------- |
| `POST /gq/forms/<id>` | `createFormsServer`   | `FORMS_RATE_LIMITER` (per form), Turnstile `remoteip` |
| `POST /gq/consent`    | `createConsentServer` | `CONSENT_RATE_LIMITER`                                |

The address is never stored.

## Default: `CF-Connecting-IP`

Cloudflare sets `CF-Connecting-IP` to whoever connected to it, overwriting
anything sent in it. Without configuration it is the client, and
`X-Forwarded-For` / `X-Real-IP` are ignored: anyone can send them.

When a Site serves its public host through a reverse proxy it runs (for
instance nginx on a VPS for a certificate Cloudflare can't hold), that proxy
is what connects to Cloudflare, so every visitor would share its address and
one rate-limit bucket.

## `trustedProxies`

Both factories take the same opt-in option:

```ts
trustedProxies?: readonly string[];
```

Each entry is an IPv4 or IPv6 address (`"192.0.2.10"`, `"2001:db8::10"`) or
CIDR (`"192.0.2.0/24"`, `"2001:db8:1:2::/64"`). An entry that isn't one, or a
`/0`, throws when the factory is called. Absent or empty, nothing changes.

For each request:

1. `CF-Connecting-IP` is the peer. If it isn't in `trustedProxies`, it is the
   client and the forwarding headers are ignored.
2. If it is, `X-Forwarded-For` is read right to left, skipping entries that are
   themselves trusted proxies; the first other entry is the client. An entry
   that isn't an address (`unknown`, garbage) ends the walk and the peer is the
   client. Entries may be `[v6]:port` or `v4:port`.
3. With no such entry, a valid untrusted `X-Real-IP` is the client.
4. Otherwise the peer (the proxy) is the client.

Only the right-most untrusted entry is believed, so a visitor who sends their
own `X-Forwarded-For` through a proxy that appends to it gains nothing. The
proxy should still replace the header rather than append (nginx:
`proxy_set_header X-Forwarded-For $remote_addr;` and
`proxy_set_header X-Real-IP $remote_addr;`).

`trustedProxies` must list only proxies the Site runs: a listed address can
claim any visitor's address.

## Rate-limit keys

An IPv4 client is keyed by its address; an IPv6 client by its /64
(`2001:db8:1:2::/64`), since one subscriber normally holds a whole /64 and
could otherwise rotate addresses for fresh buckets. This applies with or
without `trustedProxies`. IPv4-mapped IPv6 (`::ffff:192.0.2.1`) is its IPv4.
Form keys are `<formId>:<client key>`; Turnstile gets the full address.

## How a Site passes it

Pass the same list to both factories, from the Site's configuration (a Worker
`vars` entry, for instance, so a proxy's addresses change without a code
change):

```ts
// wrangler.jsonc: "vars": { "GQ_TRUSTED_PROXIES": "2.31.143.228,2a01:4f8:c016:e5cd::/64" }
const trustedProxies = (env.GQ_TRUSTED_PROXIES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const forms = createFormsServer({ cmsOrigin, descriptor, bindings, siteOrigins, trustedProxies });
const consent = createConsentServer({ siteId, bindings, siteOrigins, trustedProxies });
```

The `GQ_TRUSTED_PROXIES` name and comma-separated encoding are a suggestion
for the Site's wiring; the runtime only sees the `trustedProxies` array.
`siteOrigins` is the proxy's public origin, so same-origin checks accept posts
from it.
