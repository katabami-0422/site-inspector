const HOST = "http://127.0.0.1:3847";
const CROP_PADDING = 24;

type CaptureMessage = {
  type: "si:capture";
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number; dpr: number };
};

type ApiMessage = {
  type: "si:api";
  method: string;
  path: string;
  body?: unknown;
};

const DEFAULT_TITLE = "Site Inspector";

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  chrome.tabs
    .sendMessage(tab.id, { type: "si:toggle" })
    .then(() => chrome.action.setTitle({ title: DEFAULT_TITLE }).catch(() => {}))
    .catch(() => flashBadge("×", injectHint(tab.url)));
});

function injectHint(url: string | undefined) {
  if (url?.startsWith("file://")) {
    return "file:// のページです。chrome://extensions の Site Inspector 詳細で「ファイルの URL へのアクセスを許可」をオンにして、ページを再読み込みしてください";
  }
  return "localhost / 127.0.0.1 / file:// のページでのみ使えます。拡張を更新した場合はページも再読み込みしてください";
}

chrome.runtime.onMessage.addListener((message: ApiMessage | CaptureMessage, sender, sendResponse) => {
  if (message?.type === "si:api") {
    api(message.method, message.path, message.body)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  if (message?.type === "si:capture") {
    capture(message, sender.tab?.windowId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return true;
  }
  return undefined;
});

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${HOST}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function capture(message: CaptureMessage, windowId: number | undefined) {
  if (windowId === undefined) throw new Error("no active window");
  const pageUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const bitmap = await createImageBitmap(await (await fetch(pageUrl)).blob());
  const scaleX = bitmap.width / message.viewport.width;
  const scaleY = bitmap.height / message.viewport.height;

  const { rect, viewport } = message;
  const left = Math.max(0, rect.x - CROP_PADDING);
  const top = Math.max(0, rect.y - CROP_PADDING);
  const right = Math.min(viewport.width, rect.x + rect.width + CROP_PADDING);
  const bottom = Math.min(viewport.height, rect.y + rect.height + CROP_PADDING);
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) throw new Error("element is outside the viewport");

  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(width * scaleX)),
    Math.max(1, Math.round(height * scaleY)),
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d context is unavailable");
  context.drawImage(
    bitmap,
    Math.round(left * scaleX),
    Math.round(top * scaleY),
    Math.round(width * scaleX),
    Math.round(height * scaleY),
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const elementBlob = await canvas.convertToBlob({ type: "image/png" });
  return { page: pageUrl, element: await blobToDataUrl(elementBlob) };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function flashBadge(text: string, hint: string) {
  chrome.action.setBadgeBackgroundColor({ color: "#b45309" }).catch(() => {});
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setTitle({ title: `Site Inspector — ${hint}` }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 2500);
}
