import { createFileRoute } from "@tanstack/react-router";

const handle = async ({ request }: { request: Request }) => {
  const { consent } = await import("../lib/server");
  return (await consent.handle(request)) ?? new Response(null, { status: 404 });
};

export const Route = createFileRoute("/gq/consent")({
  server: { handlers: { POST: handle } },
});
