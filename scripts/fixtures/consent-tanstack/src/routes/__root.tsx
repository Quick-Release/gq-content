/// <reference types="vite/client" />
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ConsentBanner } from "../ConsentBanner";

export const Route = createRootRoute({
  head: () => ({ meta: [{ charSet: "utf-8" }, { title: "Shop" }] }),
  component: () => (
    <Document>
      <Outlet />
    </Document>
  ),
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-PT">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConsentBanner />
        <main>{children}</main>
        <Scripts />
      </body>
    </html>
  );
}
