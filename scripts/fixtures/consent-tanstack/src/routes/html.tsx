import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { consentPage } from "@getquick/content/consent/html";
import { configuration } from "../lib/consent";

export const Route = createFileRoute("/html")({ component: HtmlConsent });

function HtmlConsent() {
  const ui = consentPage({ configuration, language: "pt-PT" });
  useEffect(() => {
    void import("@getquick/content/consent/client").then(({ startConsent }) => {
      startConsent();
      startConsent(); // Repeated mounting must not register duplicate handlers.
    });
  }, []);
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: ui.head + ui.body + ui.footer }} />
      <Link to="/">Back to shop</Link>
    </>
  );
}
