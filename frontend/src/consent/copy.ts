import type { ConsentCategory, CopyLanguage } from "./catalog";

/**
 * Runtime-owned copy (CN-C3, CN-C4): Sites restyle it but do not edit it.
 * Drafted for CONSENT-1 and pending the legal review recorded in ADR 0008's
 * open items; changing what it says about processing bumps
 * CONSENT_COPY_REVISION.
 */
export interface ConsentCopy {
  bannerTitle: string;
  bannerText: string;
  acceptAll: string;
  rejectAll: string;
  customise: string;
  save: string;
  close: string;
  preferencesTitle: string;
  preferencesText: string;
  cookieSettings: string;
  cookiePolicy: string;
  consentId: string;
  noDecision: string;
  provider: string;
  purpose: string;
  storage: string;
  retention: string;
  thirdPartyStorage: string;
  alwaysOn: string;
  categories: Record<ConsentCategory, { name: string; description: string }>;
  placeholderText: (service: string, provider: string) => string;
  loadOnce: string;
  alwaysAllow: string;
  blockedText: (host: string) => string;
  legal: Record<string, string>;
  legalNavigation: string;
}

export const CONSENT_COPY: Record<CopyLanguage, ConsentCopy> = {
  en: {
    bannerTitle: "Your privacy choices",
    bannerText:
      "We use what is strictly necessary for this website to work. With your consent we also use the services listed in the settings, for the purposes shown there. You can accept or reject them all, choose by purpose, and change your mind at any time in Cookie settings.",
    acceptAll: "Accept all",
    rejectAll: "Reject all",
    customise: "Choose by purpose",
    save: "Save choices",
    close: "Close",
    preferencesTitle: "Cookie settings",
    preferencesText:
      "Choose which purposes you allow. Nothing optional is used until you allow it, and you can withdraw at any time.",
    cookieSettings: "Cookie settings",
    cookiePolicy: "Cookie policy",
    consentId: "Your consent ID",
    noDecision: "No choice recorded yet",
    provider: "Provider",
    purpose: "Purpose",
    storage: "Storage",
    retention: "Retention",
    thirdPartyStorage: "set by the provider; this website cannot remove it",
    alwaysOn: "Always on",
    categories: {
      necessary: {
        name: "Strictly necessary",
        description: "Needed for the website to work and to remember your choices.",
      },
      preferences: {
        name: "Preferences",
        description: "Remembers settings that make the website more convenient.",
      },
      analytics: {
        name: "Analytics",
        description: "Helps us understand, in aggregate, how the website is used.",
      },
      marketing: {
        name: "Marketing",
        description: "Measures and personalises advertising.",
      },
      external_media: {
        name: "External media",
        description: "Loads videos, maps and other content from other providers.",
      },
    },
    placeholderText: (service, provider) =>
      `This content is hosted by ${service} (${provider}). Loading it sends your IP address to that provider and may let it store data on your device.`,
    loadOnce: "Load once",
    alwaysAllow: "Always allow external media",
    blockedText: (host) => `Content from ${host} is blocked: it isn't a service this website uses.`,
    legal: {
      privacy_policy: "Privacy policy",
      cookie_policy: "Cookie policy",
      terms_of_use: "Terms of use",
      legal_notice: "Legal notice",
      terms_of_sale: "Terms of sale",
      returns_policy: "Returns policy",
      shipping_policy: "Shipping policy",
      complaints_book: "Complaints book",
      dispute_resolution: "Dispute resolution",
    },
    legalNavigation: "Legal information",
  },
  "pt-PT": {
    bannerTitle: "As suas escolhas de privacidade",
    bannerText:
      "Usamos o estritamente necessário para que este website funcione. Com o seu consentimento, usamos também os serviços indicados nas definições, para as finalidades aí descritas. Pode aceitar ou rejeitar todos, escolher por finalidade e mudar de ideias a qualquer momento nas Definições de cookies.",
    acceptAll: "Aceitar todos",
    rejectAll: "Rejeitar todos",
    customise: "Escolher por finalidade",
    save: "Guardar escolhas",
    close: "Fechar",
    preferencesTitle: "Definições de cookies",
    preferencesText:
      "Escolha as finalidades que autoriza. Nada opcional é usado até o autorizar, e pode retirar o consentimento a qualquer momento.",
    cookieSettings: "Definições de cookies",
    cookiePolicy: "Política de cookies",
    consentId: "O seu ID de consentimento",
    noDecision: "Ainda não há escolha registada",
    provider: "Fornecedor",
    purpose: "Finalidade",
    storage: "Armazenamento",
    retention: "Conservação",
    thirdPartyStorage: "definido pelo fornecedor; este website não o pode remover",
    alwaysOn: "Sempre ativo",
    categories: {
      necessary: {
        name: "Estritamente necessários",
        description:
          "Necessários para o funcionamento do website e para memorizar as suas escolhas.",
      },
      preferences: {
        name: "Preferências",
        description: "Memorizam definições que tornam o website mais conveniente.",
      },
      analytics: {
        name: "Estatísticas",
        description: "Ajudam-nos a perceber, de forma agregada, como o website é usado.",
      },
      marketing: {
        name: "Marketing",
        description: "Medem e personalizam a publicidade.",
      },
      external_media: {
        name: "Conteúdos externos",
        description: "Carregam vídeos, mapas e outros conteúdos de outros fornecedores.",
      },
    },
    placeholderText: (service, provider) =>
      `Este conteúdo está alojado em ${service} (${provider}). Carregá-lo envia o seu endereço IP a esse fornecedor e pode permitir-lhe guardar dados no seu dispositivo.`,
    loadOnce: "Carregar uma vez",
    alwaysAllow: "Permitir sempre conteúdos externos",
    blockedText: (host) =>
      `O conteúdo de ${host} está bloqueado: não é um serviço usado por este website.`,
    legal: {
      privacy_policy: "Política de privacidade",
      cookie_policy: "Política de cookies",
      terms_of_use: "Termos de utilização",
      legal_notice: "Informação legal",
      terms_of_sale: "Termos e condições de venda",
      returns_policy: "Política de devoluções",
      shipping_policy: "Política de envios",
      complaints_book: "Livro de reclamações",
      dispute_resolution: "Resolução alternativa de litígios",
    },
    legalNavigation: "Informação legal",
  },
};
