/**
 * CONSENT-1's fixed purpose categories (CN-R2) and the Runtime's closed service
 * catalog (CN-R3). Sites choose services from here; they cannot add categories
 * or services. Adding a service is a Runtime release.
 */
export const CONSENT_CATEGORIES = [
  "necessary",
  "preferences",
  "analytics",
  "marketing",
  "external_media",
] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/** The categories a visitor decides on: every one but `necessary`, which is never a choice. */
export const OPTIONAL_CATEGORIES = [
  "preferences",
  "analytics",
  "marketing",
  "external_media",
] as const satisfies readonly ConsentCategory[];
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

/** The languages Runtime-owned copy ships in (CN-C3). */
export const COPY_LANGUAGES = ["en", "pt-PT"] as const;
export type CopyLanguage = (typeof COPY_LANGUAGES)[number];
export type Copy = Record<CopyLanguage, string>;

/** The copy language for a page's `lang` (BCP 47): Portuguese pages get pt-PT, others en. */
export function copyLanguage(lang: string | undefined): CopyLanguage {
  return /^pt(?:-|$)/i.test(lang ?? "") ? "pt-PT" : "en";
}

export interface ConsentStorage {
  name: string;
  kind: "cookie" | "localStorage" | "sessionStorage";
  /** `prefix`: every item whose name starts with `name`. */
  match?: "exact" | "prefix";
  /** First-party storage the Runtime can remove on withdrawal; third-party it cannot. */
  party: "first" | "third";
  duration: Copy;
}

export interface ConsentService {
  id: string;
  category: ConsentCategory;
  /** The provider's legal name. */
  provider: string;
  name: string;
  purpose: Copy;
  storage: ConsentStorage[];
  /** How long the provider keeps the data it collects. */
  retention: Copy;
  privacyPolicy: string;
  /** Domains the service contacts; a host matches a domain or any subdomain of it. */
  hosts: string[];
  /** The embed URLs that identify this service in HTML (host, optional path prefix). */
  embeds?: Array<{ host: string; path?: string }>;
}

const consentCookieDuration: Copy = { en: "13 months", "pt-PT": "13 meses" };

export const SERVICE_CATALOG = {
  consent: {
    id: "consent",
    category: "necessary",
    provider: "This website",
    name: "Consent choices",
    purpose: {
      en: "Remembers your consent choices and the consent ID that identifies them.",
      "pt-PT": "Memoriza as suas escolhas de consentimento e o ID que as identifica.",
    },
    storage: [
      {
        name: "gq_consent",
        kind: "cookie",
        party: "first",
        duration: consentCookieDuration,
      },
    ],
    retention: {
      en: "Records: 5 years after the choice stops being in force.",
      "pt-PT": "Registos: 5 anos após a escolha deixar de estar em vigor.",
    },
    privacyPolicy: "",
    hosts: [],
  },
  turnstile: {
    id: "turnstile",
    category: "necessary",
    provider: "Cloudflare, Inc.",
    name: "Cloudflare Turnstile",
    purpose: {
      en: "Protects sign-in, registration and checkout against abuse, only on those actions.",
      "pt-PT":
        "Protege o início de sessão, o registo e a finalização de compra contra abusos, apenas nessas ações.",
    },
    storage: [],
    retention: { en: "Not stored by this website.", "pt-PT": "Não guardado por este website." },
    privacyPolicy: "https://www.cloudflare.com/privacypolicy/",
    hosts: ["challenges.cloudflare.com"],
  },
  ga4: {
    id: "ga4",
    category: "analytics",
    provider: "Google Ireland Limited",
    name: "Google Analytics 4",
    purpose: {
      en: "Measures how visitors use the website, in aggregate (Consent Mode v2, basic mode).",
      "pt-PT":
        "Mede, de forma agregada, como os visitantes usam o website (Consent Mode v2, modo básico).",
    },
    storage: [
      {
        name: "_ga",
        kind: "cookie",
        match: "prefix",
        party: "first",
        duration: { en: "Up to 2 years", "pt-PT": "Até 2 anos" },
      },
    ],
    retention: {
      en: "14 months at Google (default data retention).",
      "pt-PT": "14 meses na Google (retenção de dados predefinida).",
    },
    privacyPolicy: "https://policies.google.com/privacy",
    hosts: ["googletagmanager.com", "google-analytics.com", "analytics.google.com"],
  },
  youtube: {
    id: "youtube",
    category: "external_media",
    provider: "Google Ireland Limited",
    name: "YouTube",
    purpose: {
      en: "Plays embedded YouTube videos. Loading one sends your IP address to YouTube.",
      "pt-PT":
        "Reproduz vídeos do YouTube incorporados. Carregar um envia o seu endereço IP ao YouTube.",
    },
    storage: [
      {
        name: "VISITOR_INFO1_LIVE, YSC",
        kind: "cookie",
        party: "third",
        duration: { en: "Session to 6 months", "pt-PT": "Sessão a 6 meses" },
      },
    ],
    retention: {
      en: "Set by Google; see its privacy policy.",
      "pt-PT": "Definida pela Google; consulte a sua política de privacidade.",
    },
    privacyPolicy: "https://policies.google.com/privacy",
    hosts: ["youtube.com", "youtube-nocookie.com", "ytimg.com", "googlevideo.com", "ggpht.com"],
    embeds: [{ host: "youtube.com" }, { host: "youtube-nocookie.com" }],
  },
  vimeo: {
    id: "vimeo",
    category: "external_media",
    provider: "Vimeo.com, Inc.",
    name: "Vimeo",
    purpose: {
      en: "Plays embedded Vimeo videos. Loading one sends your IP address to Vimeo.",
      "pt-PT":
        "Reproduz vídeos do Vimeo incorporados. Carregar um envia o seu endereço IP ao Vimeo.",
    },
    storage: [
      {
        name: "vuid",
        kind: "cookie",
        party: "third",
        duration: { en: "2 years", "pt-PT": "2 anos" },
      },
    ],
    retention: {
      en: "Set by Vimeo; see its privacy policy.",
      "pt-PT": "Definida pela Vimeo; consulte a sua política de privacidade.",
    },
    privacyPolicy: "https://vimeo.com/privacy",
    hosts: ["vimeo.com", "vimeocdn.com"],
    embeds: [{ host: "player.vimeo.com" }],
  },
  google_maps: {
    id: "google_maps",
    category: "external_media",
    provider: "Google Ireland Limited",
    name: "Google Maps",
    purpose: {
      en: "Shows an embedded map. Loading it sends your IP address to Google.",
      "pt-PT": "Mostra um mapa incorporado. Carregá-lo envia o seu endereço IP à Google.",
    },
    storage: [
      {
        name: "NID",
        kind: "cookie",
        party: "third",
        duration: { en: "6 months", "pt-PT": "6 meses" },
      },
    ],
    retention: {
      en: "Set by Google; see its privacy policy.",
      "pt-PT": "Definida pela Google; consulte a sua política de privacidade.",
    },
    privacyPolicy: "https://policies.google.com/privacy",
    hosts: ["google.com", "googleapis.com", "gstatic.com"],
    embeds: [
      { host: "www.google.com", path: "/maps" },
      { host: "google.com", path: "/maps" },
      { host: "maps.google.com" },
    ],
  },
} as const satisfies Record<string, ConsentService>;

export type ServiceId = keyof typeof SERVICE_CATALOG;
export const SERVICE_IDS = Object.keys(SERVICE_CATALOG) as ServiceId[];

export function isServiceId(value: unknown): value is ServiceId {
  return typeof value === "string" && Object.hasOwn(SERVICE_CATALOG, value);
}

export function catalogService(id: ServiceId): ConsentService {
  return SERVICE_CATALOG[id];
}

/** Whether a host is a domain or one of its subdomains. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === domain || h.endsWith(`.${domain}`);
}

/** The catalog service an embed URL belongs to, if any. */
export function embedService(url: URL): ServiceId | null {
  for (const id of SERVICE_IDS) {
    const service: ConsentService = SERVICE_CATALOG[id];
    for (const embed of service.embeds ?? []) {
      if (!hostMatches(url.hostname, embed.host)) continue;
      if (embed.path && !url.pathname.startsWith(embed.path)) continue;
      return id;
    }
  }
  return null;
}

/** The catalog service whose hosts include a host, if any. */
export function hostService(host: string): ServiceId | null {
  for (const id of SERVICE_IDS) {
    const service: ConsentService = SERVICE_CATALOG[id];
    if (service.hosts.some((domain) => hostMatches(host, domain))) return id;
  }
  return null;
}
