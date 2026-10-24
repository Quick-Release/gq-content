export function GET() {
  return new Response(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="red"/></svg>',
    { headers: { "content-type": "image/svg+xml" } },
  );
}
