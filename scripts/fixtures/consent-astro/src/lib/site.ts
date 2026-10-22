// The fixture Site's wiring, as a Blueprint would do it: the content runtime
// with CONSENT-1 configured, its publication store seeded with what a refresh
// would have stored, and the consent endpoints on their own database.
import { createContentRuntime } from "@getquick/content/server";
import { migrationsDirectory } from "@getquick/content/migrations";
import { consentMigrationsDirectory } from "@getquick/content/consent/migrations";
import { createConsentServer } from "@getquick/content/consent/server";
import { d1 } from "./d1";

const dir = process.env.CONSENT_FIXTURE_DATA ?? ".";
const publications = d1(`${dir}/publications.sqlite`, migrationsDirectory, "publications");
export const consentDb = d1(`${dir}/consent.sqlite`, consentMigrationsDirectory, "consent_records");

const youtube = (id: string) =>
  `<figure class="wp-block-embed is-provider-youtube"><div class="wp-block-embed__wrapper"><iframe title="Video" width="560" height="315" src="https://www.youtube.com/embed/${id}?feature=oembed" allowfullscreen></iframe></div></figure>`;
const hero =
  '<section class="wp-block-getquick-design-video-hero"><div class="wp-block-getquick-design-video-hero__media" aria-hidden="true"><iframe class="wp-block-getquick-design-video-hero__video wp-block-getquick-design-video-hero__video--youtube" src="https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&amp;mute=1&amp;loop=1&amp;playlist=abcdefghijk" title="Decorative background video" allow="autoplay; encrypted-media" tabindex="-1" aria-hidden="true"></iframe></div><div class="wp-block-getquick-design-video-hero__content"><h1>Hero</h1></div></section>';

const legal = (lang: "pt" | "en") => ({
  controller: { name: "Acme, Lda.", privacyEmail: "privacy@acme.test", dpoContact: null },
  roles:
    lang === "pt"
      ? [
          {
            role: "privacy_policy",
            url: "/privacidade/",
            title: "Política de privacidade",
            revision: "2026-10-01T09:00:00",
            isFallback: false,
          },
          {
            role: "cookie_policy",
            url: "/cookies/",
            title: "Política de cookies",
            revision: "2026-10-02T09:00:00",
            isFallback: false,
          },
          {
            role: "complaints_book",
            url: "https://www.livroreclamacoes.pt/",
            title: null,
            revision: null,
            isFallback: false,
          },
        ]
      : [
          // Untranslated: the default-language page, flagged as a fallback.
          {
            role: "privacy_policy",
            url: "/privacidade/",
            title: "Política de privacidade",
            revision: "2026-10-01T09:00:00",
            isFallback: true,
          },
          {
            role: "cookie_policy",
            url: "/en/cookies/",
            title: "Cookie policy",
            revision: "2026-10-03T09:00:00",
            isFallback: false,
          },
          {
            role: "complaints_book",
            url: "https://www.livroreclamacoes.pt/",
            title: null,
            revision: null,
            isFallback: false,
          },
        ],
  missingRequired: [],
});
const analytics = { enabled: true, measurementId: "G-TEST1234" };
const chrome = (lang: "pt" | "en") => ({
  menuItems: [
    {
      id: "1",
      label: lang === "pt" ? "Sobre" : "About",
      href: lang === "pt" ? "/sobre/" : "/en/about/",
      target: null,
      children: [],
    },
    {
      id: "2",
      label: lang === "pt" ? "Contacto" : "Contact",
      href: "/contacto/",
      target: null,
      children: [],
    },
  ],
  siteIcon: null,
  siteLogo: null,
  legal: legal(lang),
  analytics,
});
const page = (title: string, content: string) => ({
  settings: { title: "Acme", description: "" },
  page: { title, content, hasVideoHero: false },
  colors: [],
  spacingSizes: [],
});
const entry = (
  id: string,
  uri: string,
  title: string,
  content: string,
  language: string,
  translations: Array<{ uri: string; language: string }>,
) => ({
  id,
  uri,
  title,
  content,
  language,
  translations,
  excerpt: "",
  date: "",
  featuredImage: null,
  hasVideoHero: false,
  colors: [],
  spacingSizes: [],
});

const rows: Array<[string, unknown]> = [
  ["home", page("Início", `<h1>Olá</h1>${youtube("abcdefghijk")}`)],
  ["home:en", page("Home", `<h1>Hello</h1>${youtube("abcdefghijk")}`)],
  ["chrome", chrome("pt")],
  ["chrome:en", chrome("en")],
  ["design", { colors: [], spacingSizes: [] }],
  [
    "entry:/sobre/",
    entry(
      "p1",
      "/sobre/",
      "Sobre",
      `<p>Sobre nós</p>${hero}<iframe src="https://tracker.example/frame"></iframe>`,
      "pt",
      [{ uri: "/en/about/", language: "en" }],
    ),
  ],
  [
    "entry:/en/about/",
    entry(
      "p2",
      "/en/about/",
      "About",
      `<p>About us</p>${hero}<button data-gq-consent-accept-all>Continue</button>`,
      "en",
      [{ uri: "/sobre/", language: "pt" }],
    ),
  ],
  [
    "entry:/privacidade/",
    entry("p3", "/privacidade/", "Política de privacidade", "<p>Texto legal.</p>", "pt", []),
  ],
  ["entry:/cookies/", entry("p4", "/cookies/", "Política de cookies", "<p>Cookies.</p>", "pt", [])],
  ["entry:/en/cookies/", entry("p5", "/en/cookies/", "Cookie policy", "<p>Cookies.</p>", "en", [])],
];
for (const [key, body] of rows) {
  publications.sqlite
    .prepare(
      "INSERT OR IGNORE INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES (?, 'published', 1, ?, 1, 1)",
    )
    .run(key, JSON.stringify(body));
}

export const content = createContentRuntime({
  site: "Acme",
  graphqlEndpoint: "https://cms.acme.invalid/graphql",
  cmsOrigin: "https://cms.acme.invalid",
  wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
  isServer: () => true,
  bindings: () => ({ PUBLICATION_DB: publications as never }),
  // The visitor path must never read the CMS.
  fetch: async () => {
    throw new Error("The CMS was contacted on the visitor path");
  },
  consent: { services: ["youtube", "google_maps"], cmsSettings: true },
});

export const consent = createConsentServer({
  siteId: "acme",
  bindings: () => ({
    CONSENT_DB: consentDb,
    CONSENT_READ_TOKEN: "fixture-consent-read-token-0123456789abcdef",
  }),
});
