/**
 * End-to-end check: sample app → extension (headless Edge) → local host → MCP.
 *
 * Prerequisites:
 *   npm run build:ext:test
 *   (sample-app) node ../src/host/cli.ts start --root .
 *   (sample-app) npm run dev
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(import.meta.dirname, "..");
const sampleRoot = path.join(root, "sample-app");
const extensionDir = path.join(root, "dist/extension");
const hostUrl = "http://127.0.0.1:3847";
const pageUrl = "http://localhost:5173/";
const instruction = "見出しの文字サイズを少し小さくして、行間を詰めてください。スマートフォンでは現在のサイズを維持します。";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(step, message) {
  console.log(`[e2e] ${step} ${message}`);
}

function fail(message) {
  throw new Error(message);
}

async function api(pathname, init) {
  const response = await fetch(`${hostUrl}${pathname}`, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) fail(`${pathname} → HTTP ${response.status}: ${data?.error ?? text}`);
  return data;
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("DevTools socket failed")), { once: true });
  });
  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    fail(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(label, fn, timeout = 20_000, interval = 250) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  fail(`timeout: ${label}${last instanceof Error ? ` (${last.message})` : ""}`);
}

function findBrowser() {
  return [
    process.env.SITE_INSPECTOR_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ]
    .filter(Boolean)
    .find((candidate) => fs.existsSync(candidate));
}

async function main() {
  const health = await api("/api/health").catch(() => fail("local host is not running on 3847"));
  log("host", `${health.project.name} (${health.project.root})`);

  const browser = findBrowser();
  if (!browser) fail("Edge/Chrome not found");
  if (!fs.existsSync(path.join(extensionDir, "content.js"))) {
    fail("dist/extension is missing — run `npm run build:ext:test` first");
  }

  const before = (await api("/api/requests?limit=200")).requests.length;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "site-inspector-e2e-"));
  const port = 9900 + Math.floor(Math.random() * 80);
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      "--window-size=1440,900",
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  const cleanup = () => {
    try {
      child.kill();
    } catch {}
    if (process.platform === "win32" && child.pid) {
      try {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {}
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  };

  let page;
  let sw;
  try {
    await waitFor("DevTools port", async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
      } catch {
        return false;
      }
    }, 20_000);

    const createdTab = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`,
      { method: "PUT" },
    );
    page = connect((await createdTab.json()).webSocketDebuggerUrl);
    await page.ready;
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    log("page", pageUrl);

    const targets = await waitFor("extension service worker", async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const workers = list.filter(
        (target) => target.type === "service_worker" && target.url.endsWith("/background.js"),
      );
      return workers.length ? workers : null;
    }, 20_000);

    for (const target of targets) {
      const candidate = connect(target.webSocketDebuggerUrl);
      await candidate.ready;
      await candidate.send("Runtime.enable");
      const name = await evaluate(candidate, "chrome.runtime.getManifest().name").catch(() => "");
      if (name === "Site Inspector") {
        sw = candidate;
        break;
      }
      candidate.close();
    }
    if (!sw) fail("Site Inspector service worker not found");
    log("extension", "service worker connected");

    await waitFor("content script mount", () =>
      evaluate(page, "!!document.querySelector('[data-site-inspector]')"),
    );
    log("content", "shadow host mounted");

    await evaluate(
      sw,
      `chrome.tabs.query({url: ${JSON.stringify(`${pageUrl}*`)} }).then(async (tabs) => {
         if (!tabs.length) throw new Error("sample tab not found");
         const tab = tabs[0];
         await chrome.tabs.update(tab.id, { active: true });
         await chrome.windows.update(tab.windowId, { focused: true });
         return chrome.tabs.sendMessage(tab.id, { type: "si:toggle" });
       })`,
      true,
    );
    await waitFor("inspector active", () =>
      evaluate(
        page,
        `!!document.querySelector('[data-site-inspector]').shadowRoot.querySelector('.si-pill')`,
      ),
    );
    log("inspector", "active");

    const rect = await evaluate(
      page,
      `(() => {
        const el = document.querySelector('.hero-title');
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`,
    );
    for (const type of ["mousePressed", "mouseReleased"]) {
      await page.send("Input.dispatchMouseEvent", {
        type,
        x: rect.x,
        y: rect.y,
        button: "left",
        clickCount: 1,
      });
    }

    await waitFor("request panel", () =>
      evaluate(
        page,
        `!!document.querySelector('[data-site-inspector]').shadowRoot.querySelector('.si-panel')`,
      ),
    );
    log("selection", ".hero-title");

    await evaluate(
      page,
      `document.querySelector('[data-site-inspector]').shadowRoot.querySelector('#si-instruction').focus()`,
    );
    await page.send("Input.insertText", { text: instruction });

    await waitFor("send button enabled", () =>
      evaluate(
        page,
        `(() => {
          const button = document.querySelector('[data-site-inspector]').shadowRoot.querySelector('.si-primary');
          return button && !button.disabled;
        })()`,
      ),
    );

    await evaluate(
      sw,
      `chrome.tabs.query({url: ${JSON.stringify(`${pageUrl}*`)} }).then(async (tabs) => {
         const tab = tabs[0];
         await chrome.tabs.update(tab.id, { active: true });
         await chrome.windows.update(tab.windowId, { focused: true });
         return true;
       })`,
      true,
    );

    await evaluate(
      page,
      `document.querySelector('[data-site-inspector]').shadowRoot.querySelector('.si-primary').click()`,
    );
    await waitFor("request sent", () =>
      evaluate(
        page,
        `(() => {
          const root = document.querySelector('[data-site-inspector]').shadowRoot;
          return !!root.querySelector('.si-banner--success') ||
            root.querySelector('.si-banner--error')?.textContent || '';
        })()`,
      ),
      25_000,
    );
    const outcome = await evaluate(
      page,
      `(() => {
        const root = document.querySelector('[data-site-inspector]').shadowRoot;
        const error = root.querySelector('.si-banner--error');
        if (error) return { error: error.textContent };
        return { ok: true };
      })()`,
    );
    if (outcome.error) fail(`send failed: ${outcome.error}`);
    log("send", "request accepted");

    const after = await api("/api/requests?limit=200");
    if (after.requests.length !== before + 1) {
      fail(`expected ${before + 1} requests, got ${after.requests.length}`);
    }
    const created = after.requests[0];
    const detail = await api(`/api/requests/${created.id}`);
    const stored = detail.request;
    if (!stored.element.target.selectors.join(" ").includes("hero-title")) {
      fail(`selector not captured: ${stored.element.target.selectors.join(", ")}`);
    }
    if (stored.instruction !== instruction) fail("instruction was not stored verbatim");
    if (!stored.screenshots.page || !stored.screenshots.element) {
      const uiError = await evaluate(
        page,
        `document.querySelector('[data-site-inspector]').shadowRoot.querySelector('.si-note--error')?.title ?? ''`,
      );
      const probe = await evaluate(
        sw,
        `chrome.tabs.query({url: ${JSON.stringify(`${pageUrl}*`)} }).then(async (tabs) => {
           const tab = tabs[0];
           try {
             await chrome.tabs.update(tab.id, { active: true });
             await chrome.windows.update(tab.windowId, { focused: true });
             const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
             return { ok: true, bytes: shot.length };
           } catch (error) {
             return { ok: false, error: String(error) };
           }
         })`,
        true,
      );
      fail(`screenshots were not stored (ui: ${uiError}; probe: ${JSON.stringify(probe)})`);
    }
    const screenshotDir = path.join(health.project.dataDir, "shots");
    for (const name of [stored.screenshots.page, stored.screenshots.element]) {
      if (!fs.existsSync(path.join(screenshotDir, name))) fail(`missing screenshot file ${name}`);
    }
    log("db", `request #${created.id} with ${stored.element.target.selectors.length} selectors + 2 screenshots`);

    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    const shotDir = path.join(root, ".shots");
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, "e2e-inspector.png"), Buffer.from(shot.data, "base64"));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "src/host/cli.ts"), "mcp", "--root", sampleRoot],
      stderr: "pipe",
    });
    const client = new Client({ name: "site-inspector-e2e", version: "0.1.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      const expected = [
        "list_pending_requests",
        "get_request_details",
        "get_screenshot",
        "update_request_status",
        "get_project_context",
        "get_request_history",
      ];
      for (const name of expected) {
        if (!names.includes(name)) fail(`MCP tool missing: ${name}`);
      }

      const pending = await client.callTool({ name: "list_pending_requests", arguments: {} });
      const pendingData = JSON.parse(pending.content.find((item) => item.type === "text").text);
      if (!pendingData.requests.some((request) => request.id === created.id)) {
        fail(`request #${created.id} is not in list_pending_requests`);
      }

      const details = await client.callTool({
        name: "get_request_details",
        arguments: { id: created.id },
      });
      const images = details.content.filter((item) => item.type === "image");
      if (images.length < 2) fail(`expected 2 images from get_request_details, got ${images.length}`);

      await client.callTool({
        name: "update_request_status",
        arguments: { id: created.id, status: "in_progress", note: "e2e verification" },
      });
      const updated = await api(`/api/requests/${created.id}`);
      if (updated.request.status !== "in_progress") fail("status update was not persisted");
      log("mcp", `${names.length} tools · list/details/images/status verified`);
    } finally {
      await client.close();
    }

    console.log(`\n[e2e] PASS — request #${created.id}, screenshot ${path.join(shotDir, "e2e-inspector.png")}`);
  } finally {
    page?.close();
    sw?.close();
    cleanup();
  }
}

main().catch((error) => {
  console.error(`\n[e2e] FAIL — ${error.message}`);
  process.exitCode = 1;
});
