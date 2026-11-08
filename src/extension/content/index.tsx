import { chromeBridge } from "../inspector/bridge.ts";
import { mountInspector, toggleInspector } from "../inspector/controller.tsx";

const FLAG = "__siteInspectorMounted";

type Flagged = Window & { [FLAG]?: boolean };

function isInspectableDocument() {
  if (!(document.documentElement instanceof HTMLElement)) return false;
  if (location.hostname === "127.0.0.1" && location.port === "3847") return false;
  const type = document.contentType;
  return type === "text/html" || type === "application/xhtml+xml";
}

if (isInspectableDocument() && !(window as Flagged)[FLAG]) {
  (window as Flagged)[FLAG] = true;
  mountInspector(chromeBridge);

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (message && typeof message === "object" && (message as { type?: string }).type === "si:toggle") {
      toggleInspector();
    }
    return false;
  });
}
