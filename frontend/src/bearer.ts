/**
 * Whether a request carries `Authorization: Bearer <token>`. Both sides are
 * hashed first, so the comparison's time depends on neither value nor length.
 * Shared by the refresh and consent read endpoints; dependency-free.
 */
export async function bearerMatches(request: Request, token: string): Promise<boolean> {
  const presented = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [expected, actual] = await Promise.all([digest(token), digest(presented)]);
  let difference = presented ? 0 : 1;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index]! ^ actual[index]!;
  }
  return difference === 0;
}
