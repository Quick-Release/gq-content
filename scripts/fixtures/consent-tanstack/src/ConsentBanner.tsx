// A minimal headless-core banner, as a TanStack/React adapter would build it:
// state, decisions, the cookie and the record request all come from the
// neutral export; nothing is reimplemented.
import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CONSENT_COPY,
  CONSENT_UI_VERSION,
  consentCookie,
  consentRecordRequest,
  decide,
  promptReason,
  readConsentCookie,
  type ConsentChoice,
} from "@getquick/content/consent";
import { configuration } from "./lib/consent";

export function ConsentBanner() {
  const routeLocation = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(promptReason(configuration, readConsentCookie(document.cookie)) !== null);
  }, []);
  if (!open || routeLocation.pathname === "/html") return null;
  const copy = CONSENT_COPY["pt-PT"];
  const choose = (choice: ConsentChoice) => {
    const { state, action } = decide(configuration, readConsentCookie(document.cookie), choice);
    document.cookie = consentCookie(state, { secure: location.protocol === "https:" });
    setOpen(false);
    void fetch("/gq/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        consentRecordRequest(state, action, { language: "pt-PT", uiVersion: CONSENT_UI_VERSION }),
      ),
    });
  };
  return (
    <section id="gq-consent-banner" role="dialog" aria-modal="false" aria-label={copy.bannerTitle}>
      <p>{copy.bannerText}</p>
      <button
        type="button"
        data-gq-consent-reject-all
        onClick={() => choose({ kind: "reject_all" })}
      >
        {copy.rejectAll}
      </button>
      <button
        type="button"
        data-gq-consent-accept-all
        onClick={() => choose({ kind: "accept_all" })}
      >
        {copy.acceptAll}
      </button>
    </section>
  );
}
