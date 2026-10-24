import { renderDesignPattern } from "../../../src/design-patterns";
import { mountDesignNavigation } from "../../../src/navigation-client";
import { nativeNavigationShell, customNavigationShell } from "./saved-shells";

// Run on browser.html with the canonical presentation and interaction CSS loaded:
// await (await import('./saved-shell-acceptance.ts')).savedShellAcceptance()
export function savedShellAcceptance() {
  const assert = (condition: unknown, label: string) => {
    if (!condition) throw new Error(label);
  };
  const key = (node: HTMLElement, value: string, shiftKey = false) =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }),
    );
  const host = document.createElement("section");
  document.body.append(host);
  const results: string[] = [];
  try {
    for (const [name, content] of [
      ["core/navigation", nativeNavigationShell],
      ["getquick-design/navigation", customNavigationShell],
    ]) {
      host.innerHTML =
        '<button id="saved-outside">Outside</button>' +
        renderDesignPattern([
          {
            name,
            attributes: {
              overlayMenu: "always",
              submenuVisibility: "click",
              items: [{ label: "Raw", url: "/raw" }],
            },
            content,
            children: [],
          },
        ]);
      const nav = host.querySelector<HTMLElement>("[data-gqd-navigation]")!;
      const panel = nav.querySelector<HTMLElement>("[data-gqd-navigation-panel]")!;
      const open = nav.querySelector<HTMLButtonElement>("[data-gqd-navigation-open]")!;
      const close = nav.querySelector<HTMLButtonElement>("[data-gqd-navigation-close]")!;
      const toggle = nav.querySelector<HTMLButtonElement>("[data-gqd-submenu]")!;
      const list = nav.querySelector<HTMLElement>("[data-gqd-submenu-list]")!;
      const outside = host.querySelector<HTMLButtonElement>("#saved-outside")!;
      // Authored display restoration must never override the closed state.
      panel.style.setProperty("display", "flex", "important");
      list.style.setProperty("display", "flex", "important");
      const serverState = () => nav.outerHTML.replaceAll(' style=""', "");
      const before = serverState();
      const cleanup = mountDesignNavigation(host);
      try {
        assert(
          panel.hidden && panel.style.getPropertyPriority("display") === "important",
          `${name}: closed panel overrides presentation display`,
        );
        assert(!nav.querySelector('a[href="/raw"]'), `${name}: published links are authoritative`);
        open.click();
        assert(
          document.activeElement === close && panel.getAttribute("aria-modal") === "true",
          `${name}: modal focuses close`,
        );
        assert(outside.inert, `${name}: background is inert`);
        const last = nav.querySelector<HTMLAnchorElement>('a[href="/last"]')!;
        close.focus();
        key(close, "Tab", true);
        assert(document.activeElement === last, `${name}: Shift Tab wraps`);
        key(last, "Tab");
        assert(document.activeElement === close, `${name}: Tab wraps`);
        toggle.focus();
        key(toggle, "ArrowDown");
        assert(
          document.activeElement === list.querySelector("a"),
          `${name}: submenu enters saved child`,
        );
        assert(
          !list.hidden && nav.querySelector('[aria-current="page"]'),
          `${name}: submenu and current link survive`,
        );
        if (name === "core/navigation") {
          const nested = list.querySelector<HTMLButtonElement>("[data-gqd-submenu]")!;
          nested.focus();
          key(nested, "ArrowLeft");
          assert(
            document.activeElement?.textContent === "Deep",
            "native: RTL enters nested submenu",
          );
          key(document.activeElement as HTMLElement, "ArrowRight");
          assert(
            document.activeElement === nested && nested.getAttribute("aria-expanded") === "false",
            "native: RTL returns to nested owner",
          );
        }
        key(document.activeElement as HTMLElement, "Escape");
        assert(
          document.activeElement === toggle && list.hidden,
          `${name}: Escape returns submenu focus`,
        );
        key(toggle, "Escape");
        assert(
          panel.hidden && document.activeElement === open && !outside.inert,
          `${name}: Escape closes modal and unlocks background`,
        );
        const duplicate = mountDesignNavigation(host);
        duplicate();
        assert(
          nav.hasAttribute("data-gqd-navigation-enhanced"),
          `${name}: duplicate mount preserves ownership`,
        );
        open.click();
      } finally {
        cleanup();
        cleanup();
      }
      assert(
        !outside.inert && serverState() === before,
        `${name}: cleanup restores server state including inline display`,
      );
      const remount = mountDesignNavigation(host);
      open.click();
      assert(panel.getAttribute("aria-modal") === "true", `${name}: remount restores interactions`);
      remount();
      nav.dataset.gqdOverlay = "never";
      nav.dataset.gqdSubmenuVisibility = "hover";
      const desktopCleanup = mountDesignNavigation(host);
      try {
        assert(!panel.hidden, `${name}: desktop retains visible published links`);
        const row = toggle.closest("li")!;
        row.dispatchEvent(new PointerEvent("pointerenter"));
        assert(!list.hidden, `${name}: desktop hover opens saved submenu`);
        const parentLink = row.querySelector<HTMLAnchorElement>("a")!;
        parentLink.focus();
        key(parentLink, "Escape");
        assert(
          list.hidden && document.activeElement === toggle,
          `${name}: Escape on saved parent closes submenu`,
        );
        row.dispatchEvent(new PointerEvent("pointerenter"));
        outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        assert(list.hidden, `${name}: outside pointer closes saved submenu`);
      } finally {
        desktopCleanup();
      }
      results.push(name);
    }
    return {
      passed: true,
      shells: results,
      checks:
        "authoritative links, overlay, focus, inert, Tab, Escape, nested RTL submenu, hover, outside pointer, current, cleanup, remount",
    };
  } finally {
    host.remove();
  }
}
