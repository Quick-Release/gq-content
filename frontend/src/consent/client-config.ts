import type { ConsentConfiguration } from "./configuration";

/** The JSON the server renders into `<script type="application/json" id="gq-consent-config">`. */
export interface ConsentPageConfig {
  configuration: ConsentConfiguration;
  /** The page's `lang`, recorded as the banner language. */
  language: string;
  uiVersion: string;
  legalRevisions: Record<string, string>;
  endpoint: string;
}

export const CONSENT_CONFIG_ID = "gq-consent-config";
