import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // No scroll restoration: it would write sessionStorage on every visit.
  return createRouter({ routeTree, scrollRestoration: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
