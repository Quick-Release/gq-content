import type { configuredDelivery } from "./delivery";
import {
  isLanguageHome as homeAt,
  routeLanguage as languageAt,
  languageSubject,
  type SiteLanguage,
} from "./site-language";
export function configuredRefresh(
  languages: SiteLanguage[],
  delivery: ReturnType<typeof configuredDelivery>,
) {
  const { refreshAuthority, isAuthorized, refreshEntries, refreshSite } = delivery;
  const isLanguageHome = (route: string) => homeAt(route, languages);
  const routeLanguage = (route: string) => languageAt(route, languages);
  /** The most entries one targeted refresh reads. */
  const MAX_URIS = 100;

  function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
    return Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store", ...headers },
    });
  }

  /** The paths a targeted refresh asks for, none for the whole Site, or why the request is invalid. */
  async function requestedPaths(
    request: Request,
  ): Promise<{ paths?: string[] } | { invalid: string }> {
    const text = await request.text();
    if (!text.trim()) return {};
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { invalid: "The request body isn't JSON." };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { invalid: "The request body must be a JSON object." };
    }
    const { uris, ...others } = body as Record<string, unknown>;
    if (Object.keys(others).length > 0) {
      return { invalid: `Unknown field: ${Object.keys(others).join(", ")}.` };
    }
    if (uris === undefined) return {};
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_URIS) {
      return { invalid: `uris must list 1 to ${MAX_URIS} paths.` };
    }
    for (const uri of uris) {
      if (typeof uri !== "string" || !/^\/(?!\/)[^?#\s]*$/.test(uri) || uri.length > 2048) {
        return { invalid: `uris must be paths such as /about/, not ${JSON.stringify(uri)}.` };
      }
      if (isLanguageHome(uri)) {
        const subject = languageSubject(routeLanguage(uri), "front page");
        return { invalid: `${uri} is ${subject}: refresh the whole Site for it.` };
      }
    }
    return { paths: uris as string[] };
  }

  async function handleRefresh(
    request: Request,
    { siteOrigin }: { siteOrigin?: string } = {},
  ): Promise<Response> {
    const authority = await refreshAuthority();
    if ("refused" in authority) {
      return answer(403, { error: `Refresh is disabled: ${authority.refused}.` });
    }
    if (!(await isAuthorized(request, authority.token))) {
      return answer(
        401,
        { error: "A refresh needs this Frontend's refresh token as a bearer token." },
        { "WWW-Authenticate": 'Bearer realm="gq-refresh"' },
      );
    }

    const requested = await requestedPaths(request);
    if ("invalid" in requested) return answer(400, { error: requested.invalid });

    const report = requested.paths
      ? await refreshEntries(authority.store, requested.paths)
      : await refreshSite(authority.store, siteOrigin);
    return answer(report.refreshed ? 200 : 503, report);
  }

  return { handleRefresh };
}
