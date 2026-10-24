import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from "parse5";
import { escapeAttribute, safeContentUrl } from "./html";
import { presentationHtml, resolveDesignTheme, type DesignThemeOverrides } from "./presentation";

type Attributes = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const objects = (value: unknown): Attributes[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Attributes => !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
const wrapper = (className: string, attrs: Attributes) =>
  `class="${escapeAttribute([className, text(attrs.className), attrs.align === "wide" || attrs.align === "full" ? `align${attrs.align}` : ""].filter(Boolean).join(" "))}"${text(attrs.anchor) ? ` id="${escapeAttribute(text(attrs.anchor))}"` : ""}`;
let sequence = 0;
const id = () => `gqd-navigation-${++sequence}`;

export const DESIGN_NAVIGATION_BLOCKS = new Set([
  "getquick-design/navigation",
  "core/navigation",
  "core/navigation-link",
  "core/navigation-submenu",
  "core/page-list",
  "core/page-list-item",
  "getquick-design/social-links",
  "core/social-links",
  "core/social-link",
  "polylang/language-switcher",
]);

/** Public iconSvg is an image, never an executable HTML subtree. */
function iconSvg(value: unknown): string {
  const fragment = parseFragment(text(value));
  const allowed = new Set([
    "svg",
    "g",
    "path",
    "circle",
    "ellipse",
    "rect",
    "line",
    "polyline",
    "polygon",
    "title",
  ]);
  const attributes = new Set([
    "viewBox",
    "width",
    "height",
    "d",
    "fill",
    "fill-rule",
    "clip-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "points",
    "transform",
    "xmlns",
  ]);
  const clean = (parent: DefaultTreeAdapterMap["parentNode"]) => {
    parent.childNodes = parent.childNodes.filter((node) => {
      if (!("tagName" in node)) return false;
      if (!allowed.has(node.tagName)) return false;
      node.attrs = node.attrs.filter(
        (attr) => attributes.has(attr.name) && !/url\s*\(|[<>]/i.test(attr.value),
      );
      clean(node);
      return true;
    });
  };
  clean(fragment);
  if (
    fragment.childNodes.length !== 1 ||
    !("tagName" in fragment.childNodes[0]!) ||
    fragment.childNodes[0].tagName !== "svg"
  )
    return "";
  const svg = fragment.childNodes[0];
  svg.attrs.push({ name: "aria-hidden", value: "true" }, { name: "focusable", value: "false" });
  return serialize(fragment);
}

function link(
  attributes: Attributes,
  className: string,
  contents = escapeAttribute(text(attributes.label)),
): string {
  const url = safeContentUrl(attributes.url);
  const target =
    text(attributes.target || attributes.linkTarget) ||
    (attributes.opensInNewTab === true ? "_blank" : "");
  const allowedTarget = ["_blank", "_self", "_parent", "_top"].includes(target) ? target : "";
  const rel = new Set(
    text(attributes.rel)
      .split(/\s+/)
      .filter((part) => /^[a-z-]+$/i.test(part)),
  );
  if (allowedTarget === "_blank") {
    rel.add("noopener");
    rel.add("noreferrer");
  }
  return `<a class="${className}" aria-label="${escapeAttribute(text(attributes.label))}"${url ? ` href="${escapeAttribute(url)}"` : ""}${allowedTarget ? ` target="${allowedTarget}"` : ""}${rel.size ? ` rel="${escapeAttribute([...rel].join(" "))}"` : ""}${attributes.current === true ? ' aria-current="page"' : ""}>${contents}</a>`;
}

/** A native Page List keeps its own canonical root inside a list item. */
function listContents(html: string): string {
  return parseFragment(html)
    .childNodes.map((node) =>
      "tagName" in node && node.tagName !== "li"
        ? `<li class="gqd-navigation-group">${serializeOuter(node)}</li>`
        : serializeOuter(node),
    )
    .join("");
}

function item(name: string, attributes: Attributes, children = "", custom = false): string {
  if (name === "core/page-list-item")
    attributes = {
      ...attributes,
      label: text(attributes.label) || text(attributes.title),
      url: text(attributes.url) || text(attributes.link),
    };
  const nested = objects(attributes.children);
  if (nested.length)
    children = nested
      .map((child) =>
        item(
          custom
            ? name
            : name === "core/page-list-item"
              ? name
              : objects(child.children).length
                ? "core/navigation-submenu"
                : "core/navigation-link",
          child,
          "",
          custom,
        ),
      )
      .join("");
  const hasChildren = !!children;
  const presentationName = custom
    ? hasChildren
      ? "core/navigation-submenu"
      : "core/navigation-link"
    : name;
  const itemClass = custom
    ? `gqd-navigation__item ${hasChildren ? "wp-block-navigation-submenu" : "wp-block-navigation-link"}`
    : name === "core/page-list-item"
      ? "wp-block-pages-list__item"
      : name === "core/navigation-submenu"
        ? "wp-block-navigation-submenu"
        : "wp-block-navigation-link";
  const listClass = custom
    ? "gqd-navigation__submenu wp-block-navigation__submenu-container"
    : "wp-block-navigation__submenu-container";
  const listId = hasChildren ? id() : "";
  const toggle = hasChildren
    ? `<button type="button" data-gqd-submenu aria-expanded="false" aria-controls="${listId}" aria-label="${escapeAttribute(`Toggle submenu: ${text(attributes.label)}`)}">${'<span aria-hidden="true">⌄</span>'}</button>`
    : "";
  const html = `<li class="${itemClass}"${typeof attributes.id === "string" || typeof attributes.id === "number" ? ` data-navigation-item="${escapeAttribute(String(attributes.id))}"` : ""}>${link(attributes, custom ? "gqd-navigation__link" : "wp-block-navigation-item__content")}${toggle}${hasChildren ? `<ul id="${listId}" class="${listClass}" data-gqd-submenu-list>${listContents(children)}</ul>` : ""}</li>`;
  return presentationHtml(presentationName, html, attributes.presentation, { attributes });
}

type HtmlElement = DefaultTreeAdapterMap["element"];
const attr = (node: HtmlElement, name: string) =>
  node.attrs.find((entry) => entry.name === name)?.value;
const setAttr = (node: HtmlElement, name: string, value = "") => {
  const existing = node.attrs.find((entry) => entry.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
};
const hasClass = (node: HtmlElement, name: string) =>
  attr(node, "class")?.split(/\s+/).includes(name);
const elements = (parent: DefaultTreeAdapterMap["parentNode"]): HtmlElement[] =>
  parent.childNodes.flatMap((node) => ("tagName" in node ? [node, ...elements(node)] : []));
const append = (parent: HtmlElement, node: HtmlElement) => {
  node.parentNode = parent;
  parent.childNodes.push(node);
};
const control = (label: string): HtmlElement =>
  parseFragment(
    `<button type="button" aria-label="${escapeAttribute(label)}">${escapeAttribute(label)}</button>`,
  ).childNodes[0] as HtmlElement;

/** Enhance known native/custom navigation landmarks inside ordinary delivered
 * HTML. This does not reinterpret links, presentation controls or query data. */
export function enhanceDesignNavigationHtml(html: string): string {
  if (!html.includes("wp-block-navigation") && !html.includes("gqd-navigation__landmark"))
    return html;
  return savedNavigation(html, {});
}

/** Add interaction hooks to the authoritative published tree. Never reconstruct
 * links from attributes/children: those may precede publication filtering. */
function savedNavigation(shell: string, attrs: Attributes): string {
  const fragment = parseFragment(shell);
  const all = elements(fragment);
  const usedIds = new Set(all.map((node) => attr(node, "id")).filter(Boolean));
  const ensureId = (node: HtmlElement) => {
    let value = attr(node, "id");
    if (!value) {
      do {
        value = id();
      } while (usedIds.has(value));
      setAttr(node, "id", value);
      usedIds.add(value);
    }
    return value;
  };
  for (const nav of all.filter(
    (node) =>
      node.tagName === "nav" &&
      (hasClass(node, "wp-block-navigation") || hasClass(node, "gqd-navigation__landmark")),
  )) {
    // Each landmark owns its own controls, including when shells are nested.
    const owned = elements(nav).filter((node) => {
      for (
        let parent = node.parentNode;
        parent && parent !== nav;
        parent = "parentNode" in parent ? parent.parentNode : null
      )
        if ("tagName" in parent && parent.tagName === "nav") return false;
      return true;
    });
    if (
      attr(nav, "data-gqd-navigation") !== undefined &&
      owned.some((node) => attr(node, "data-gqd-navigation-panel") !== undefined) &&
      owned.some((node) => attr(node, "data-gqd-navigation-open") !== undefined) &&
      owned.some((node) => attr(node, "data-gqd-navigation-close") !== undefined)
    )
      continue;
    const authoredOverlayControl = owned.some(
      (node) =>
        node.tagName === "button" &&
        (hasClass(node, "wp-block-navigation__responsive-container-open") ||
          hasClass(node, "gqd-navigation__toggle")),
    );
    let panel = owned.find(
      (node) =>
        hasClass(node, "wp-block-navigation__responsive-container") ||
        hasClass(node, "gqd-navigation__menu"),
    );
    if (!panel) {
      // Overlay-disabled native output can contain only its direct list.
      const list = owned.find((node) => hasClass(node, "wp-block-navigation__container"));
      if (!list || list.parentNode !== nav) continue;
      panel = parseFragment('<div class="wp-block-navigation__responsive-container"></div>')
        .childNodes[0] as HtmlElement;
      nav.childNodes[nav.childNodes.indexOf(list)] = panel;
      panel.parentNode = nav;
      append(panel, list);
    }
    const label =
      attr(nav, "aria-label") || text(attrs.ariaLabel) || text(attrs.label) || "Navigation";
    if (!attr(nav, "aria-label")) setAttr(nav, "aria-label", label);
    let open = owned.find(
      (node) =>
        node.tagName === "button" &&
        (hasClass(node, "wp-block-navigation__responsive-container-open") ||
          hasClass(node, "gqd-navigation__toggle")),
    );
    if (!open) {
      open = control(`Open ${label}`);
      open.parentNode = nav;
      nav.childNodes.unshift(open);
    }
    let close = owned.find(
      (node) =>
        node.tagName === "button" &&
        hasClass(node, "wp-block-navigation__responsive-container-close"),
    );
    if (!close) {
      const closeLabel =
        owned.map((node) => attr(node, "data-navigation-close-label")).find(Boolean) ||
        `Close ${label}`;
      close = control(closeLabel);
      close.parentNode = panel;
      panel.childNodes.unshift(close);
    }
    setAttr(nav, "data-gqd-navigation");
    setAttr(
      nav,
      "data-gqd-overlay",
      attrs.overlayMenu === "never"
        ? "never"
        : attrs.overlayMenu === "always" || hasClass(open, "always-shown")
          ? "always"
          : attrs.overlayMenu === "mobile" || authoredOverlayControl
            ? "mobile"
            : "never",
    );
    setAttr(
      nav,
      "data-gqd-submenu-visibility",
      ["click", "always"].includes(text(attrs.submenuVisibility))
        ? text(attrs.submenuVisibility)
        : attrs.openSubmenusOnClick === true || hasClass(nav, "open-on-click")
          ? "click"
          : "hover",
    );
    setAttr(nav, "data-gqd-submenu-icons", String(attrs.showSubmenuIcon !== false));
    setAttr(panel, "data-gqd-navigation-panel");
    setAttr(open, "data-gqd-navigation-open");
    setAttr(open, "aria-controls", ensureId(panel));
    setAttr(open, "aria-haspopup", "dialog");
    if (
      !attr(open, "aria-label") &&
      !elements(open).some((node) => attr(node, "data-navigation-open-label"))
    )
      setAttr(open, "aria-label", `Open ${label}`);
    setAttr(close, "data-gqd-navigation-close");
    for (const list of owned.filter(
      (node) =>
        hasClass(node, "wp-block-navigation__submenu-container") ||
        hasClass(node, "gqd-navigation__submenu"),
    )) {
      const row = list.parentNode;
      if (!row || !("tagName" in row) || row.tagName !== "li") continue;
      const rowElements = elements(row).filter((node) => {
        for (
          let parent = node.parentNode;
          parent && parent !== row;
          parent = "parentNode" in parent ? parent.parentNode : null
        )
          if ("tagName" in parent && parent.tagName === "li") return false;
        return true;
      });
      let toggle = rowElements.find(
        (node) =>
          node.tagName === "button" &&
          (hasClass(node, "wp-block-navigation__submenu-icon") ||
            hasClass(node, "wp-block-navigation-submenu__toggle") ||
            hasClass(node, "gqd-navigation__submenu-toggle")),
      );
      if (!toggle) {
        const link = rowElements.find((node) => node.tagName === "a");
        const content = (node: DefaultTreeAdapterMap["node"]): string =>
          "value" in node
            ? node.value
            : "childNodes" in node
              ? node.childNodes.map(content).join("")
              : "";
        toggle = control(`Toggle submenu: ${link ? content(link).trim() : label}`);
        toggle.parentNode = row;
        row.childNodes.splice(row.childNodes.indexOf(list), 0, toggle);
      }
      setAttr(toggle, "data-gqd-submenu");
      setAttr(toggle, "aria-controls", ensureId(list));
      setAttr(list, "data-gqd-submenu-list");
    }
  }
  return serialize(fragment);
}

/** Render resolved public navigation, native children, social and conditional
 * Polylang nodes. childrenHtml is already rendered trusted block HTML. A complete
 * saved shell is retained; presentation always uses the canonical renderer. */
export function renderDesignNavigation(
  name: string,
  attrs: Attributes,
  childrenHtml = "",
  shell = "",
): string {
  if (shell.trim())
    return presentationHtml(
      name,
      name === "core/navigation" || name === "getquick-design/navigation"
        ? savedNavigation(shell, attrs)
        : shell,
      attrs.presentation,
      { attributes: attrs },
    );
  const custom = name === "getquick-design/navigation";
  if (["core/navigation-link", "core/navigation-submenu", "core/page-list-item"].includes(name))
    return item(name, attrs, childrenHtml);
  if (name === "core/page-list") {
    const contents = childrenHtml.trim()
      ? childrenHtml
      : Array.isArray(attrs.items)
        ? objects(attrs.items)
            .map((entry) => item("core/page-list-item", entry))
            .join("")
        : childrenHtml;
    return presentationHtml(
      name,
      `<ul ${wrapper("wp-block-page-list", attrs)}>${contents}</ul>`,
      attrs.presentation,
      { attributes: attrs },
    );
  }
  if (custom || name === "core/navigation") {
    // Prefer native child composition to retain authored Page List and submenu
    // wrappers. Resolved items are the fallback, never a second copy of links.
    const contents = childrenHtml.trim()
      ? childrenHtml
      : Array.isArray(attrs.items)
        ? objects(attrs.items)
            .map((entry) =>
              item(
                custom
                  ? name
                  : objects(entry.children).length
                    ? "core/navigation-submenu"
                    : "core/navigation-link",
                entry,
                "",
                custom,
              ),
            )
            .join("")
        : childrenHtml;
    const menuId = id();
    const overlay =
      attrs.overlayMenu === "never"
        ? "never"
        : attrs.overlayMenu === "always"
          ? "always"
          : "mobile";
    const visibility = ["click", "always"].includes(text(attrs.submenuVisibility))
      ? text(attrs.submenuVisibility)
      : attrs.openSubmenusOnClick === true
        ? "click"
        : "hover";
    const label = text(attrs.ariaLabel) || text(attrs.label) || "Navigation";
    const list = `<ul class="${custom ? "gqd-navigation__list" : "wp-block-navigation__container"}">${listContents(contents)}</ul>`;
    const open = `<button type="button" data-gqd-navigation-open aria-expanded="false" aria-controls="${menuId}" aria-haspopup="dialog" aria-label="Open ${escapeAttribute(label)}">☰</button>`;
    const close =
      '<button type="button" data-gqd-navigation-close aria-label="Close navigation">×</button>';
    // The native nesting is part of the canonical descriptor's direct list target.
    const menu = custom
      ? `<div class="gqd-navigation__menu" data-gqd-navigation-panel id="${menuId}">${close}${list}</div>`
      : `<div class="wp-block-navigation__responsive-container" data-gqd-navigation-panel id="${menuId}"><div class="wp-block-navigation__responsive-close"><div class="wp-block-navigation__responsive-dialog"><div class="wp-block-navigation__responsive-container-content">${close}${list}</div></div></div></div>`;
    return presentationHtml(
      name,
      `<nav ${wrapper(custom ? "wp-block-getquick-design-navigation" : "wp-block-navigation", attrs)} data-gqd-navigation data-gqd-overlay="${overlay}" data-gqd-submenu-visibility="${visibility}" data-gqd-submenu-icons="${attrs.showSubmenuIcon !== false}" aria-label="${escapeAttribute(label)}">${open}${menu}</nav>`,
      attrs.presentation,
      { attributes: attrs },
    );
  }
  if (name === "getquick-design/social-links" || name === "core/social-links") {
    const contents = Array.isArray(attrs.links)
      ? objects(attrs.links)
          .map((entry) => {
            const label = text(entry.label) || text(entry.service);
            const icon = safeContentUrl(entry.iconUrl);
            const svg = iconSvg(entry.iconSvg);
            return `<li${entry.service ? ` data-social-service="${escapeAttribute(text(entry.service))}"` : ""}>${link({ ...entry, label }, "gqd-social-link", icon ? `<img src="${escapeAttribute(icon)}" alt="${escapeAttribute(label)}">` : svg ? `${svg}<span class="gqd-navigation-sr">${escapeAttribute(label)}</span>` : escapeAttribute(label))}</li>`;
          })
          .join("")
      : childrenHtml;
    return presentationHtml(
      name,
      `<ul ${wrapper(name === "core/social-links" ? "wp-block-social-links" : "wp-block-getquick-design-social-links", attrs)}>${contents}</ul>`,
      attrs.presentation,
      { attributes: attrs },
    );
  }
  if (name === "core/social-link")
    return `<li data-social-service="${escapeAttribute(text(attrs.service))}">${link({ ...attrs, label: text(attrs.label) || text(attrs.service) }, "wp-block-social-link-anchor")}</li>`;
  if (name === "polylang/language-switcher") {
    // The producer already resolves eligible URLs (including force_home and
    // Polylang URL filters). noTranslation describes the source translation;
    // it is not permission to discard an already resolved public destination.
    const entries = objects(attrs.links).filter(
      (entry) =>
        !(attrs.dropdown !== true && attrs.hide_current === true && entry.current === true),
    );
    if (!entries.length) return "";
    const contents = entries
      .map((entry) => {
        const label = text(entry.label) || text(entry.locale) || text(entry.slug);
        const flag = attrs.show_flags === true ? safeContentUrl(entry.flagUrl) : "";
        const content = `${flag ? `<img src="${escapeAttribute(flag)}" alt="${attrs.show_names === false ? escapeAttribute(label) : ""}">` : ""}${attrs.show_names !== false || !flag ? escapeAttribute(label) : ""}`;
        return `<li lang="${escapeAttribute(text(entry.locale).replaceAll("_", "-"))}" dir="${entry.direction === "rtl" ? "rtl" : "ltr"}" data-language="${escapeAttribute(text(entry.slug))}">${link(entry, "gqd-language-link", content)}</li>`;
      })
      .join("");
    // URLs (including force_home) are resolved by Polylang; never derive them.
    const root = wrapper("wp-block-polylang-language-switcher", attrs);
    const html =
      attrs.dropdown === true
        ? `<details ${root} data-gqd-language-menu><summary>${escapeAttribute(text(objects(attrs.links).find((entry) => entry.current === true)?.label) || "Languages")}</summary><ul>${contents}</ul></details>`
        : `<ul ${root} aria-label="Languages">${contents}</ul>`;
    return presentationHtml(name, html, attrs.presentation, { attributes: attrs });
  }
  return childrenHtml;
}

/** Interaction styles only. Include canonical presentationStyleSheet separately. */
export function navigationStyleSheet(theme?: DesignThemeOverrides): string {
  const threshold = resolveDesignTheme(theme).breakpoints.lg;
  return `[data-gqd-navigation]{--gqd-navigation-breakpoint:${threshold}}
.gqd-navigation-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
[data-gqd-navigation] :focus-visible{outline:2px solid currentColor;outline-offset:3px}
[data-gqd-navigation] ul{list-style:none}
[data-gqd-navigation] li{position:relative}
[data-gqd-navigation-open],[data-gqd-navigation-close],[data-gqd-submenu]{display:none}
[data-gqd-navigation-enhanced] [data-gqd-submenu]{display:inline-block}
[data-gqd-submenu-visibility="always"] [data-gqd-submenu]{display:none}
[data-gqd-submenu-icons="false"] [data-gqd-submenu] > span{visibility:hidden}
[data-gqd-navigation] [hidden]{display:none!important}
[data-gqd-navigation-enhanced] [data-gqd-submenu-list]{position:absolute;inset-block-start:100%;inset-inline-start:0;z-index:1}
[data-gqd-navigation-enhanced] [data-gqd-submenu-list] [data-gqd-submenu-list]{inset-block-start:0;inset-inline-start:100%}
[data-gqd-navigation-enhanced][data-gqd-overlay-active] > [data-gqd-navigation-open]{display:inline-block}
[data-gqd-navigation-enhanced][data-gqd-overlay-active] [data-gqd-navigation-close]{display:inline-block}
[data-gqd-navigation-enhanced][data-gqd-overlay-active] > [data-gqd-navigation-panel]:not([hidden]){position:fixed;inset:0;overflow:auto;z-index:1000;background:Canvas;color:CanvasText}
[data-gqd-navigation-enhanced][data-gqd-overlay-active] [data-gqd-submenu-list]{position:static}
@media(prefers-reduced-motion:reduce){[data-gqd-navigation] *,[data-gqd-navigation] *::before,[data-gqd-navigation] *::after{transition:none!important;animation:none!important}}`;
}
