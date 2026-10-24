/** Mount each Carousel once. Sites invoke on page load and call cleanup before
 * client navigation replaces the page. DOM APIs are read only on invocation. */
export function mountDesignCarousels(root?: ParentNode): () => void {
  const scope = root ?? (typeof document === "undefined" ? undefined : document);
  if (!scope) return () => {};
  const carousels = [...scope.querySelectorAll<HTMLElement>("[data-gqd-carousel]")];
  if (
    "matches" in scope &&
    typeof scope.matches === "function" &&
    scope.matches("[data-gqd-carousel]")
  )
    carousels.unshift(scope as HTMLElement);
  const cleanups: (() => void)[] = [];
  for (const carousel of carousels) {
    if (carousel.hasAttribute("data-gqd-mounted")) continue;
    const slides = [...carousel.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains("wp-block-getquick-design-slider"),
    );
    if (!slides.length) continue;
    carousel.setAttribute("data-gqd-mounted", "");
    const view = carousel.ownerDocument.defaultView;
    if (!view) continue;
    const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
    const buttons = [...carousel.querySelectorAll<HTMLButtonElement>("button[data-gqd-go]")].filter(
      (node) => node.closest("[data-gqd-carousel]") === carousel,
    );
    const previous = slides.map((slide) => ({
      slide,
      hidden: slide.hidden,
      inert: slide.inert,
      role: slide.getAttribute("role"),
      label: slide.getAttribute("aria-label"),
      description: slide.getAttribute("aria-roledescription"),
    }));
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hovered = false;
    let focused = false;
    let stopped = false;
    const listeners: (() => void)[] = [];
    const listen = (target: EventTarget, name: string, handler: EventListener) => {
      target.addEventListener(name, handler);
      listeners.push(() => target.removeEventListener(name, handler));
    };
    const cancel = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      cancel();
      if (
        stopped ||
        carousel.dataset.gqdAutoplay !== "true" ||
        slides.length < 2 ||
        motion.matches ||
        hovered ||
        focused ||
        carousel.ownerDocument.hidden
      )
        return;
      const seconds = Number(carousel.dataset.gqdDuration);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) return;
      timer = setTimeout(() => {
        if (motion.matches || hovered || focused || carousel.ownerDocument.hidden) {
          schedule();
          return;
        }
        show(index + 1);
      }, seconds * 1000);
    };
    const show = (next: number) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, position) => {
        slide.dataset.gqdSlide = "";
        slide.hidden = position !== index;
        slide.inert = position !== index;
        slide.setAttribute("role", "group");
        slide.setAttribute("aria-roledescription", "slide");
        slide.setAttribute("aria-label", `${position + 1} of ${slides.length}`);
      });
      buttons.forEach((button) => {
        if (Number(button.dataset.gqdGo) === index) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      });
      schedule();
    };
    listen(carousel, "click", (event) => {
      const target =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      if (!target || target.closest("[data-gqd-carousel]") !== carousel) return;
      if (target.hasAttribute("data-gqd-next")) show(index + 1);
      else if (target.hasAttribute("data-gqd-previous")) show(index - 1);
      else if (target.dataset.gqdGo !== undefined) show(Number(target.dataset.gqdGo));
    });
    listen(carousel, "keydown", (event) => {
      if (
        !(event instanceof KeyboardEvent) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        target.closest("[data-gqd-carousel]") !== carousel ||
        target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const rtl = view.getComputedStyle(carousel).direction === "rtl";
      show(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? slides.length - 1
            : index + ((event.key === "ArrowRight") !== rtl ? 1 : -1),
      );
    });
    listen(carousel, "mouseenter", () => {
      hovered = true;
      cancel();
    });
    listen(carousel, "mouseleave", () => {
      hovered = false;
      schedule();
    });
    listen(carousel, "focusin", () => {
      focused = true;
      cancel();
    });
    listen(carousel, "focusout", (event) => {
      focused =
        event instanceof FocusEvent &&
        event.relatedTarget instanceof Node &&
        carousel.contains(event.relatedTarget);
      schedule();
    });
    listen(motion, "change", schedule);
    listen(carousel.ownerDocument, "visibilitychange", schedule);
    show(0);
    cleanups.push(() => {
      stopped = true;
      cancel();
      listeners.forEach((remove) => remove());
      carousel.removeAttribute("data-gqd-mounted");
      for (const { slide, hidden, inert, role, label, description } of previous) {
        slide.hidden = hidden;
        slide.inert = inert;
        slide.removeAttribute("data-gqd-slide");
        for (const [name, value] of [
          ["role", role],
          ["aria-label", label],
          ["aria-roledescription", description],
        ]) {
          if (value === null) slide.removeAttribute(name!);
          else slide.setAttribute(name!, value!);
        }
      }
    });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
