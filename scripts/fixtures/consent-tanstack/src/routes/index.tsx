import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <>
      <h1>Loja</h1>
      <Link to="/html">HTML consent</Link>
    </>
  ),
});
