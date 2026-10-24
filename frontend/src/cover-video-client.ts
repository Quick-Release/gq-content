const mounted = new WeakSet<HTMLVideoElement>();

/** Mount decorative native Cover backgrounds in neutral, saved or delivered HTML.
 * No DOM access occurs until invocation. The Site owns mounting and cleanup. */
export function mountDesignCoverVideos(root?: ParentNode): () => void {
  const scope = root ?? document;
  const videos = Array.from(
    scope.querySelectorAll<HTMLVideoElement>(
      ".wp-block-cover > video.wp-block-cover__video-background",
    ),
  );
  const cleanups = videos.map((video) => {
    const view = video.ownerDocument.defaultView;
    if (!view || mounted.has(video)) return () => {};
    mounted.add(video);
    const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    // Also protect callers mounting an untouched native shell.
    video.autoplay = false;
    video.removeAttribute("autoplay");
    video.muted = true;
    const update = () => {
      if (!active || motion.matches) {
        video.pause();
        return;
      }
      void video.play().then(
        () => {
          if ((active && motion.matches) || (!active && !mounted.has(video))) video.pause();
        },
        () => {},
      );
    };
    motion.addEventListener("change", update);
    update();
    return () => {
      if (!active) return;
      active = false;
      motion.removeEventListener("change", update);
      mounted.delete(video);
      video.pause();
    };
  });
  return () => cleanups.forEach((cleanup) => cleanup());
}
