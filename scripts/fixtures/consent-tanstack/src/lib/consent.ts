// The storefront's consent configuration: GA4 switched on by settings,
// Turnstile necessary on checkout (CN-C2). Neutral core only.
import { consentConfiguration } from "@getquick/content/consent";

export const configuration = consentConfiguration({
  services: ["turnstile"],
  analytics: { enabled: true, measurementId: "G-SHOP1234" },
  controller: "Shop, SA",
});
