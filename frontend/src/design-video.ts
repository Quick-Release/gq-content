import { nativeBlockHtml } from "./native-block";
import { parseFragment } from "parse5";
import { escapeAttribute, safeContentUrl } from "./html";
import { presentationHtml } from "./presentation";

export const VIDEO_HERO_BLOCK = "getquick-design/video-hero";
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export function youtubeVideoId(value: string): string {
  try {
    const url = new URL(value);
    if (
      !/^https?:\/\//i.test(value) ||
      url.username ||
      url.password ||
      !["https:", "http:"].includes(url.protocol)
    )
      return "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const id =
      host === "youtu.be"
        ? url.pathname.split("/").filter(Boolean)[0]
        : ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)
          ? url.searchParams.get("v") ||
            url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]
          : "";
    return id && YOUTUBE_ID.test(id) ? id : "";
  } catch {
    return "";
  }
}

/** Render canonical decorative media with accessible ordered foreground content.
 * A complete canonical saved shell retains its media/title/link identities. */
export function renderDesignVideoHero(
  attributes: Record<string, unknown>,
  children: string,
  shell?: string,
  options: { mediaHtml?: (html: string) => string } = {},
): string {
  const root = shell
    ? parseFragment(shell, { sourceCodeLocationInfo: true }).childNodes.find(
        (node) => "tagName" in node,
      )
    : undefined;
  if (root && "attrs" in root) {
    const content = root.childNodes.find(
      (node) =>
        "attrs" in node &&
        node.attrs.some(
          (attr) =>
            attr.name === "class" && attr.value.split(/\s+/).includes("gqd-video-hero__content"),
        ),
    );
    if (
      content &&
      "tagName" in content &&
      content.sourceCodeLocation?.startTag &&
      content.sourceCodeLocation.endTag
    ) {
      let html = children
        ? shell!.slice(0, content.sourceCodeLocation.startTag.endOffset) +
          children +
          shell!.slice(content.sourceCodeLocation.endTag.startOffset)
        : shell!;
      if (options.mediaHtml) {
        const renderedRoot = parseFragment(html, { sourceCodeLocationInfo: true }).childNodes.find(
          (node) => "tagName" in node,
        );
        const media =
          renderedRoot && "childNodes" in renderedRoot
            ? renderedRoot.childNodes.find(
                (node) =>
                  "attrs" in node &&
                  node.attrs.some(
                    (attr) =>
                      attr.name === "class" &&
                      attr.value.split(/\s+/).includes("gqd-video-hero__media"),
                  ),
              )
            : undefined;
        const location = media && "tagName" in media ? media.sourceCodeLocation : undefined;
        if (location?.startTag && location.endTag) {
          const source = html.slice(location.startTag.endOffset, location.endTag.startOffset);
          if (/<iframe\b/i.test(source))
            html =
              html.slice(0, location.startTag.endOffset) +
              options.mediaHtml(source) +
              html.slice(location.endTag.startOffset);
        }
      }
      return presentationHtml(VIDEO_HERO_BLOCK, html, attributes.presentation, { attributes });
    }
  }
  const posterUrl = safeContentUrl(attributes.posterUrl);
  const poster = posterUrl
    ? `<img class="gqd-video-hero__poster" src="${escapeAttribute(posterUrl)}" alt="" loading="eager">`
    : "";
  let media = poster;
  if (attributes.videoType === "youtube") {
    const id = typeof attributes.videoUrl === "string" ? youtubeVideoId(attributes.videoUrl) : "";
    if (id) {
      const query = new URLSearchParams({
        autoplay: "1",
        mute: "1",
        controls: "0",
        loop: "1",
        playlist: id,
        playsinline: "1",
        rel: "0",
      });
      const title =
        typeof attributes.iframeTitle === "string" && attributes.iframeTitle.trim()
          ? attributes.iframeTitle
          : "Decorative background video";
      media += `<iframe class="gqd-video-hero__video gqd-video-hero__video--youtube" data-src="https://www.youtube-nocookie.com/embed/${id}?${escapeAttribute(query.toString())}" title="${escapeAttribute(title)}" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true"></iframe>`;
    }
  } else {
    const src = safeContentUrl(attributes.videoUrl);
    if (src)
      media += `<video class="gqd-video-hero__video" src="${escapeAttribute(src)}"${posterUrl ? ` poster="${escapeAttribute(posterUrl)}"` : ""} muted loop playsinline preload="metadata" aria-hidden="true"></video>`;
  }
  if (options.mediaHtml) media = options.mediaHtml(media);
  const opening =
    root?.sourceCodeLocation?.startTag && shell
      ? shell.slice(0, root.sourceCodeLocation.startTag.endOffset)
      : '<section class="wp-block-getquick-design-video-hero">';
  return presentationHtml(
    VIDEO_HERO_BLOCK,
    nativeBlockHtml(
      `${opening}<div class="gqd-video-hero__media" aria-hidden="true">${media}</div><div class="gqd-video-hero__content">${children}</div></section>`,
      attributes,
    ),
    attributes.presentation,
    { attributes },
  );
}
