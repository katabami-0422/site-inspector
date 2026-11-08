import { createRoot } from "react-dom/client";
import css from "./styles.css?inline";
import { App } from "./App.tsx";
import type { Bridge } from "./bridge.ts";

const HOST_ATTR = "data-site-inspector";

let mounted = false;

export function mountInspector(bridge: Bridge): () => void {
  if (mounted || document.querySelector(`[${HOST_ATTR}]`)) return () => {};

  const host = document.createElement("div");
  host.setAttribute(HOST_ATTR, "");
  host.style.cssText = [
    "position: fixed",
    "inset: 0",
    "z-index: 2147483645",
    "display: block",
    "pointer-events: none",
  ].join(";");

  const shadow = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];
  const root = document.createElement("div");
  root.style.cssText = "position: absolute; inset: 0; pointer-events: none;";
  shadow.append(root);
  document.documentElement.append(host);

  const reactRoot = createRoot(root);
  reactRoot.render(<App host={host} bridge={bridge} />);
  mounted = true;

  return () => {
    reactRoot.unmount();
    host.remove();
    mounted = false;
  };
}

export { toggleInspector } from "./events.ts";
