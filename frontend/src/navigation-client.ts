const mounted = new WeakSet<Element>();
const inertLocks = new WeakMap<HTMLElement, { count: number; original: boolean }>();

function inertBackground(panel: HTMLElement): () => void {
  const locked: HTMLElement[] = [];
  for (let branch = panel; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !("inert" in sibling)) continue;
      const node = sibling as HTMLElement;
      const lock = inertLocks.get(node) ?? { count: 0, original: node.inert };
      lock.count += 1;
      inertLocks.set(node, lock);
      node.inert = true;
      locked.push(node);
    }
    if (branch.parentElement === panel.ownerDocument.body) break;
  }
  return () => {
    for (const node of locked) {
      const lock = inertLocks.get(node);
      if (!lock || --lock.count > 0) continue;
      node.inert = lock.original;
      inertLocks.delete(node);
    }
  };
}

/** Mount the adapter's navigation markup once; cleanup restores server state.
 * Native links retain ordinary Tab order (this is navigation, not an ARIA menu).
 * Install navigationStyleSheet alongside the canonical presentation stylesheet. */
export function mountDesignNavigation(root?: ParentNode): () => void {
  const scope = root ?? (typeof document === "undefined" ? undefined : document);
  if (!scope) return () => {};
  const cleanups: (() => void)[] = [];
  const languageMenus = [
    ...scope.querySelectorAll<HTMLDetailsElement>("details[data-gqd-language-menu]"),
  ];
  if (
    "matches" in scope &&
    typeof scope.matches === "function" &&
    scope.matches("details[data-gqd-language-menu]")
  )
    languageMenus.unshift(scope as HTMLDetailsElement);
  for (const menu of languageMenus) {
    if (mounted.has(menu)) continue;
    mounted.add(menu);
    const original = menu.open;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.open) {
        event.preventDefault();
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    menu.addEventListener("keydown", escape);
    cleanups.push(() => {
      menu.removeEventListener("keydown", escape);
      menu.open = original;
      mounted.delete(menu);
    });
  }
  const roots = [...scope.querySelectorAll<HTMLElement>("[data-gqd-navigation]")];
  if (
    "matches" in scope &&
    typeof scope.matches === "function" &&
    scope.matches("[data-gqd-navigation]")
  )
    roots.unshift(scope as HTMLElement);
  for (const nav of roots) {
    if (mounted.has(nav)) continue;
    const view = nav.ownerDocument.defaultView;
    const panel = nav.querySelector<HTMLElement>("[data-gqd-navigation-panel]");
    const open = nav.querySelector<HTMLButtonElement>("[data-gqd-navigation-open]");
    const close = nav.querySelector<HTMLButtonElement>("[data-gqd-navigation-close]");
    if (!view || !panel || !open || !close) continue;
    mounted.add(nav);
    const buttons = [...nav.querySelectorAll<HTMLButtonElement>("[data-gqd-submenu]")];
    const lists = new Map(
      buttons.map((button) => [
        button,
        [...nav.querySelectorAll<HTMLElement>("[data-gqd-submenu-list]")].find(
          (list) => list.id === button.getAttribute("aria-controls"),
        ),
      ]),
    );
    const saved = new Map<HTMLElement, Map<string, string | null>>();
    const remember = (node: HTMLElement, names: string[]) =>
      saved.set(node, new Map(names.map((name) => [name, node.getAttribute(name)])));
    remember(nav, ["data-gqd-navigation-enhanced", "data-gqd-overlay-active"]);
    remember(panel, ["hidden", "role", "aria-modal", "aria-label", "style"]);
    remember(open, ["aria-expanded"]);
    buttons.forEach((button) => remember(button, ["aria-expanded"]));
    for (const list of lists.values()) if (list) remember(list, ["hidden", "style"]);
    const restore = (node: HTMLElement, names: string[]) => {
      for (const name of names) {
        const value = saved.get(node)?.get(name);
        if (value == null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }
    };
    // Resolved explicit current state wins. Otherwise determine it in the route
    // context, which is deliberately absent from this server renderer's API.
    const currentUrl = new URL(nav.ownerDocument.URL);
    const path = (value: string) => value.replace(/\/+$/, "") || "/";
    for (const anchor of nav.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (anchor.hasAttribute("aria-current")) continue;
      try {
        const target = new URL(anchor.getAttribute("href")!, nav.ownerDocument.baseURI);
        if (
          !target.hash &&
          target.origin === currentUrl.origin &&
          path(target.pathname) === path(currentUrl.pathname) &&
          (!target.search || target.search === currentUrl.search)
        ) {
          remember(anchor, ["aria-current"]);
          anchor.setAttribute("aria-current", "page");
        }
      } catch {
        /* Invalid saved links never become current. */
      }
    }
    const listeners: (() => void)[] = [];
    const listen = (node: EventTarget, name: string, callback: EventListener) => {
      node.addEventListener(name, callback);
      listeners.push(() => node.removeEventListener(name, callback));
    };
    let overlay = false;
    let expanded = false;
    let unlock: (() => void) | undefined;
    const element = (target: EventTarget | null): Element | null =>
      target && "nodeType" in target && target.nodeType === 1 ? (target as Element) : null;
    // Interaction state must outrank canonical authored display restoration.
    // Restore the original inline declarations when visible and on cleanup.
    const setHidden = (node: HTMLElement, hidden: boolean) => {
      node.hidden = hidden;
      restore(node, ["style"]);
      if (hidden) node.style.setProperty("display", "none", "important");
    };
    const setSubmenu = (button: HTMLButtonElement, state: boolean) => {
      const list = lists.get(button);
      button.setAttribute("aria-expanded", String(state));
      if (list) setHidden(list, !state);
      if (!state && list)
        for (const nested of buttons)
          if (list.contains(nested)) {
            nested.setAttribute("aria-expanded", "false");
            const child = lists.get(nested);
            if (child) setHidden(child, true);
          }
    };
    const focusables = (node: HTMLElement) =>
      [
        ...node.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),summary,[tabindex="0"]',
        ),
      ].filter(
        (candidate) =>
          !candidate.closest("[hidden]") &&
          view.getComputedStyle(candidate).visibility !== "hidden" &&
          candidate.getClientRects().length > 0,
      );
    const setOverlay = (state: boolean, returnFocus = false) => {
      expanded = state && overlay;
      open.setAttribute("aria-expanded", String(expanded));
      setHidden(panel, overlay && !expanded);
      if (expanded) {
        unlock ??= inertBackground(panel);
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        panel.setAttribute("aria-label", nav.getAttribute("aria-label") || "Navigation");
        focusables(panel)[0]?.focus();
      } else {
        unlock?.();
        unlock = undefined;
        restore(panel, ["role", "aria-modal", "aria-label"]);
        if (returnFocus) open.focus();
      }
    };
    const threshold =
      view.getComputedStyle(nav).getPropertyValue("--gqd-navigation-breakpoint").trim() || "64rem";
    const mobile = view.matchMedia(`(width < ${threshold})`);
    const sync = () => {
      const previous = overlay;
      const focused = nav.ownerDocument.activeElement;
      const panelFocused = focused !== null && panel.contains(focused);
      overlay =
        nav.dataset.gqdOverlay === "always" ||
        (nav.dataset.gqdOverlay !== "never" && mobile.matches);
      nav.toggleAttribute("data-gqd-overlay-active", overlay);
      setOverlay(previous === overlay && expanded);
      if (previous !== overlay) {
        if (overlay && panelFocused) open.focus();
        else if (!overlay && (focused === open || focused === close)) focusables(panel)[0]?.focus();
      }
    };
    nav.setAttribute("data-gqd-navigation-enhanced", "");
    for (const button of buttons) setSubmenu(button, nav.dataset.gqdSubmenuVisibility === "always");
    sync();
    listen(mobile, "change", sync);
    listen(nav.ownerDocument, "focusin", (event) => {
      const target = element(event.target);
      if (expanded && target && !panel.contains(target)) focusables(panel)[0]?.focus();
    });
    listen(open, "click", () => setOverlay(true));
    listen(close, "click", () => {
      setOverlay(false, true);
    });
    for (const button of buttons) {
      listen(button, "click", () => {
        if (nav.dataset.gqdSubmenuVisibility !== "always")
          setSubmenu(button, button.getAttribute("aria-expanded") !== "true");
      });
      const row = button.closest("li") ?? button.parentElement!;
      const hover = () => {
        if (nav.dataset.gqdSubmenuVisibility === "hover" && !overlay) setSubmenu(button, true);
      };
      listen(row, "pointerenter", hover);
      listen(row, "pointerleave", () => {
        if (
          nav.dataset.gqdSubmenuVisibility === "hover" &&
          !row.contains(nav.ownerDocument.activeElement)
        )
          setSubmenu(button, false);
      });
      listen(row, "focusin", (event) => {
        if (event.target !== button) hover();
      });
      listen(row, "focusout", (event) => {
        const next = (event as FocusEvent).relatedTarget as Node | null;
        if (!next || !row.contains(next))
          if (nav.dataset.gqdSubmenuVisibility !== "always") setSubmenu(button, false);
      });
    }
    listen(nav, "keydown", (raw) => {
      const event = raw as KeyboardEvent;
      const target = element(event.target);
      if (!target || event.altKey || event.ctrlKey || event.metaKey) return;
      const rtl = view.getComputedStyle(nav).direction === "rtl";
      const button = target.closest<HTMLButtonElement>("[data-gqd-submenu]");
      if (button && ["ArrowDown", rtl ? "ArrowLeft" : "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        setSubmenu(button, true);
        const list = lists.get(button);
        if (list) focusables(list)[0]?.focus();
        return;
      }
      if (event.key === "Escape" || event.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
        const list = target.closest<HTMLElement>("[data-gqd-submenu-list]");
        const row = target.closest("li");
        const parentToggle =
          event.key === "Escape" && row
            ? buttons.find(
                (candidate) =>
                  candidate.closest("li") === row &&
                  candidate.getAttribute("aria-expanded") === "true",
              )
            : null;
        const owner =
          parentToggle ??
          (button?.getAttribute("aria-expanded") === "true"
            ? button
            : list
              ? buttons.find((candidate) => lists.get(candidate) === list)
              : null);
        if (
          owner &&
          owner.getAttribute("aria-expanded") === "true" &&
          nav.dataset.gqdSubmenuVisibility !== "always"
        ) {
          event.preventDefault();
          event.stopPropagation();
          setSubmenu(owner, false);
          owner.focus();
          return;
        }
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          setOverlay(false, true);
        }
      }
      if (event.key === "Tab" && expanded) {
        const candidates = focusables(panel);
        const first = candidates[0],
          last = candidates.at(-1);
        if (event.shiftKey && target === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && target === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
    listen(nav.ownerDocument, "pointerdown", (event) => {
      const target = element(event.target);
      if (target && !nav.contains(target) && nav.dataset.gqdSubmenuVisibility !== "always")
        buttons.forEach((button) => setSubmenu(button, false));
    });
    cleanups.push(() => {
      listeners.forEach((remove) => remove());
      unlock?.();
      for (const [node, attributes] of saved) restore(node, [...attributes.keys()]);
      mounted.delete(nav);
    });
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
  };
}
