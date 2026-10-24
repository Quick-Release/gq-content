// Run in the real browser after browser.html has loaded:
// await (await import('/frontend/tests/fixtures/navigation/acceptance.js')).navigationAcceptance()
export function navigationAcceptance() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const key = (node, key, shiftKey = false) =>
    node.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    );
  const fixture = document.querySelector("#fixture");
  let nav = fixture.querySelector("[data-gqd-navigation]");
  const overlay = nav.hasAttribute("data-gqd-overlay-active");
  const opener = nav.querySelector("[data-gqd-navigation-open]");
  const panel = nav.querySelector("[data-gqd-navigation-panel]");
  if (overlay) {
    assert(panel.hidden, "Closed overlay must hide its links");
    opener.click();
    assert(panel.getAttribute("aria-modal") === "true", "Overlay must be a modal dialog");
    assert(
      document.activeElement.matches("[data-gqd-navigation-close]"),
      "Overlay must focus its close control",
    );
    const outside = document.querySelector('a[href="#before"]');
    outside.focus();
    assert(panel.contains(document.activeElement), "Background focus must not escape a modal");
    key(document.activeElement, "Tab", true);
    assert(
      document.activeElement.textContent === "Contact",
      "Shift Tab must wrap to the last visible link",
    );
    key(document.activeElement, "Tab");
    assert(
      document.activeElement.matches("[data-gqd-navigation-close]"),
      "Tab must wrap to the first visible control",
    );
  }
  if (!overlay) {
    const parentLink = nav.querySelector("li > a");
    parentLink.focus();
    key(parentLink, "Escape");
    assert(
      nav.querySelector("[data-gqd-submenu]").getAttribute("aria-expanded") === "false",
      "Escape on a parent link must close its submenu",
    );
  }
  const trigger = nav.querySelector("[data-gqd-submenu]");
  trigger.focus();
  key(trigger, "ArrowDown");
  assert(document.activeElement.textContent === "Shop", "ArrowDown must enter the submenu");
  key(document.activeElement, "Escape");
  assert(
    document.activeElement === trigger && trigger.getAttribute("aria-expanded") === "false",
    "Escape must close submenu and return focus",
  );
  if (overlay) {
    key(trigger, "Escape");
    assert(
      panel.hidden && document.activeElement === opener,
      "Escape must close overlay and return focus",
    );
  } else {
    nav.querySelector("li").dispatchEvent(new PointerEvent("pointerenter"));
    assert(trigger.getAttribute("aria-expanded") === "true", "Hover must open the submenu");
  }
  const duplicateCleanup = window.remountNavigation();
  duplicateCleanup();
  assert(
    nav.hasAttribute("data-gqd-navigation-enhanced"),
    "Repeated mounts must not take ownership",
  );
  nav.setAttribute("data-external-owner", "retained");
  window.cleanupNavigation();
  assert(
    nav.getAttribute("data-external-owner") === "retained",
    "Cleanup must preserve unrelated mutations",
  );
  assert(
    !nav.hasAttribute("data-gqd-navigation-enhanced") && !panel.hidden,
    "Cleanup must restore server markup",
  );
  assert(
    !nav.querySelector("[data-gqd-submenu-list]").hidden,
    "Without JS all resolved links must remain accessible",
  );
  // Use the same public API for native item targets and RTL keyboard behavior.
  const original = window.navigationFixture;
  fixture.innerHTML = window.renderNavigation("core/navigation", {
    ...original.attributes,
    overlayMenu: "never",
    submenuVisibility: "click",
  });
  nav = fixture.querySelector("nav");
  nav.dir = "rtl";
  window.cleanupNavigation = window.remountNavigation();
  const nativeTrigger = nav.querySelector("[data-gqd-submenu]");
  nativeTrigger.focus();
  key(nativeTrigger, "ArrowLeft");
  assert(
    document.activeElement.textContent === "Shop",
    "RTL inline-end arrow must enter the submenu",
  );
  key(document.activeElement, "ArrowRight");
  assert(document.activeElement === nativeTrigger, "RTL inline-start arrow must return focus");
  const current = window.renderNavigation("core/navigation-link", {
    label: "Current",
    url: "/current",
    current: true,
  });
  assert(current.includes('aria-current="page"'), "Resolved current item must remain current");
  window.cleanupNavigation();
  fixture.innerHTML = window.renderNavigation("core/navigation", {
    overlayMenu: "never",
    items: [{ id: "current", label: "Current route", url: location.pathname, children: [] }],
  });
  window.cleanupNavigation = window.remountNavigation();
  assert(
    fixture.querySelector("a").getAttribute("aria-current") === "page",
    "Navigation must recognize its current route when the producer omits current state",
  );
  window.cleanupNavigation();
  fixture.innerHTML = window.renderNavigation("polylang/language-switcher", {
    dropdown: true,
    links: [
      {
        slug: "ar",
        locale: "ar",
        label: "العربية",
        url: "/ar/",
        flagUrl: null,
        current: true,
        direction: "rtl",
        noTranslation: false,
      },
    ],
  });
  window.cleanupNavigation = window.remountNavigation();
  const details = fixture.querySelector("details");
  details.open = true;
  const language = details.querySelector("a");
  language.focus();
  key(language, "Escape");
  assert(
    !details.open && document.activeElement === details.querySelector("summary"),
    "Language dropdown Escape must close and return focus",
  );
  window.cleanupNavigation();
  return {
    passed: true,
    overlay,
    direction: "ltr + rtl",
    checks:
      "submenu, overlay, focus, Tab, Escape, hover, current, cleanup, remount, language dropdown",
  };
}

// Real media-query transitions in an isolated, resizable browsing context.
export async function navigationBreakpointAcceptance() {
  const frame = document.createElement("iframe");
  frame.style.width = "1200px";
  frame.style.height = "800px";
  const node = window.navigationFixture;
  const html = window.renderNavigation(node.name, node.attributes);
  const css = document.querySelector("style").textContent;
  // srcdoc avoids the dev server's page-reload client during a resize check.
  frame.srcdoc = `<!doctype html><style>${css}</style>${html}<script type="module">import {mountDesignNavigation} from "${location.origin}/frontend/src/navigation-client.ts";window.cleanupNavigation=mountDesignNavigation();window.navigationReady=true;</script>`;
  document.body.append(frame);
  const wait = async (condition, label) => {
    for (let i = 0; i < 120; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `Breakpoint transition timed out: ${label}; width=${frame.contentWindow?.innerWidth}; ready=${frame.contentWindow?.navigationReady}`,
    );
  };
  try {
    await wait(() => frame.contentWindow?.navigationReady, "load");
    const doc = frame.contentDocument;
    const nav = doc.querySelector("[data-gqd-navigation]");
    const panel = nav.querySelector("[data-gqd-navigation-panel]");
    const open = nav.querySelector("[data-gqd-navigation-open]");
    const close = nav.querySelector("[data-gqd-navigation-close]");
    nav.querySelector("a").focus();
    frame.style.width = "600px";
    await wait(() => {
      frame.getBoundingClientRect();
      return nav.hasAttribute("data-gqd-overlay-active");
    }, "enter-mobile");
    if (!panel.hidden || doc.activeElement !== open)
      throw new Error("Entering mobile must move hidden link focus to opener");
    open.click();
    frame.style.width = "1200px";
    await wait(() => {
      frame.getBoundingClientRect();
      return !nav.hasAttribute("data-gqd-overlay-active");
    }, "leave-mobile");
    if (
      panel.hidden ||
      doc.activeElement === close ||
      doc.activeElement === open ||
      !panel.contains(doc.activeElement)
    )
      throw new Error("Leaving mobile must retain visible navigation focus");
    frame.contentWindow.cleanupNavigation();
    return {
      passed: true,
      widths: [1200, 600, 1200],
      focus: "link -> opener -> dialog -> visible link",
    };
  } finally {
    frame.remove();
  }
}
