import type { AncestorInfo, ElementInfo, Rect, TargetInfo } from "../../shared/types.ts";

const STYLE_PROPS = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "gap",
  "row-gap",
  "column-gap",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
  "color",
  "background-color",
  "background-image",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "transform",
  "transition",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "grid-template-rows",
  "overflow",
  "aspect-ratio",
  "object-fit",
];

const IDENTITY_ATTRS = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "data-component",
  "aria-label",
  "name",
  "placeholder",
];

export function isInspectorNode(el: Element | null): boolean {
  return Boolean(el?.closest("[data-site-inspector]"));
}

/** SVG の path などを選んだときは、最も近い HTML 要素に寄せる。 */
export function nearestHtml(el: Element | null): HTMLElement | null {
  let node: Element | null = el;
  while (node && !(node instanceof HTMLElement)) node = node.parentElement;
  return node instanceof HTMLElement ? node : null;
}

export function toRect(rect: DOMRect): Rect {
  return {
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
  };
}

export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).slice(0, 2).join(".");
  const rect = el.getBoundingClientRect();
  return `${tag}${classes ? `.${classes}` : ""} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${CSS.escape(el.id)}`;
  const classes = Array.from(el.classList)
    .slice(0, 2)
    .map((name) => `.${CSS.escape(name)}`)
    .join("");
  return tag + classes;
}

function pathSelector(el: Element, maxDepth: number): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;

  while (node && node !== document.documentElement && depth < maxDepth) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${CSS.escape(node.id)}`);
      break;
    }
    const parent = node.parentElement;
    if (parent) {
      const tag = node.tagName;
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === tag);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
    depth += 1;
  }

  return parts.join(" > ");
}

export function selectorCandidates(el: Element): string[] {
  const candidates: string[] = [];
  const add = (selector: string) => {
    if (selector && !candidates.includes(selector)) candidates.push(selector);
  };

  if (el.id) add(`#${CSS.escape(el.id)}`);
  for (const attr of IDENTITY_ATTRS) {
    const value = el.getAttribute(attr);
    if (value) add(`[${attr}="${escapeAttribute(value)}"]`);
  }
  add(describe(el));
  add(pathSelector(el, 4));
  add(pathSelector(el, 12));

  const unique = candidates.filter(isUnique);
  const rest = candidates.filter((selector) => !unique.includes(selector));
  return [...unique, ...rest].slice(0, 6);
}

function ancestorsOf(el: Element): AncestorInfo[] {
  const result: AncestorInfo[] = [];
  let node: Element | null = el.parentElement;
  while (node && node !== document.documentElement && result.length < 4) {
    result.push({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      classes: Array.from(node.classList).slice(0, 6),
      selector: describe(node),
      rect: toRect(node.getBoundingClientRect()),
    });
    node = node.parentElement;
  }
  return result;
}

export function extractElementInfo(el: HTMLElement): ElementInfo {
  const rect = toRect(el.getBoundingClientRect());
  const computed = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(prop);
    if (value) styles[prop] = value;
  }

  const rawText = el.innerText ?? el.textContent ?? "";
  const target: TargetInfo = {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList).slice(0, 20),
    selectors: selectorCandidates(el),
    text: rawText.replace(/\s+/g, " ").trim().slice(0, 240),
    rect,
    pageRect: {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      width: rect.width,
      height: rect.height,
    },
    ancestors: ancestorsOf(el),
  };

  return {
    target,
    styles,
    html: el.outerHTML.replace(/\s+/g, " ").slice(0, 4000),
  };
}

export function resolveSelectors(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement && !isInspectorNode(el)) return el;
    } catch {
      // invalid selector after a markup change; try the next candidate
    }
  }
  return null;
}
