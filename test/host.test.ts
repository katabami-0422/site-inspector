import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { listen } from "../src/host/http.ts";
import { Store } from "../src/host/store.ts";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ORIGIN = `chrome-extension://${"a".repeat(32)}`;
const cliPath = fileURLToPath(new URL("../src/host/cli.ts", import.meta.url));

const root = mkdtempSync(join(tmpdir(), "site-inspector-test-"));
const store = new Store(root);
let server: Awaited<ReturnType<typeof listen>>;
let base = "";
let port = 0;

before(async () => {
  server = await listen(store, 0);
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
  store.close();
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    pageUrl: "http://localhost:5173/",
    pageTitle: "Sample",
    viewport: { width: 1440, height: 900, dpr: 1 },
    element: {
      target: {
        tag: "h1",
        id: null,
        classes: ["hero-title"],
        selectors: ["main .hero h1", "h1.hero-title"],
        text: "Welcome",
        rect: { x: 100, y: 200, width: 600, height: 90 },
        pageRect: { x: 100, y: 200, width: 600, height: 90 },
        ancestors: [],
      },
      styles: { fontSize: "64px", fontWeight: "700" },
      html: '<h1 class="hero-title">Welcome</h1>',
    },
    instruction: "文字を少し小さくして、文字間隔を広げてほしい。",
    intent: "heroを落ち着かせたい",
    scope: "element",
    priority: "normal",
    screenshots: {
      page: `data:image/png;base64,${PNG_1X1}`,
      element: `data:image/png;base64,${PNG_1X1}`,
    },
    ...overrides,
  };
}

test("rejects a foreign origin", async () => {
  const res = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify(body()),
  });
  assert.equal(res.status, 403);
});

test("requires an origin for writes", async () => {
  const res = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body()),
  });
  assert.equal(res.status, 403);
});

test("creates a request and stores screenshots", async () => {
  const res = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body()),
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as { id: number; status: string };
  assert.equal(created.status, "pending");

  const health = (await fetch(`${base}/api/health`).then((r) => r.json())) as {
    counts: Record<string, number>;
    project: { root: string };
  };
  assert.equal(health.project.root, store.project().root);
  assert.equal(health.counts.pending, 1);

  const list = (await fetch(`${base}/api/requests`).then((r) => r.json())) as {
    requests: Array<{ id: number; hasScreenshot: boolean }>;
  };
  assert.equal(list.requests[0].id, created.id);
  assert.equal(list.requests[0].hasScreenshot, true);

  const detail = (await fetch(`${base}/api/requests/${created.id}`).then((r) => r.json())) as {
    request: { instruction: string; element: { target: { selectors: string[] } } };
    events: Array<{ status: string }>;
  };
  assert.match(detail.request.instruction, /文字を少し小さく/);
  assert.equal(detail.request.element.target.selectors[0], "main .hero h1");
  assert.equal(detail.events[0].status, "pending");

  const shot = await fetch(`${base}/api/requests/${created.id}/screenshot?kind=element`);
  assert.equal(shot.status, 200);
  assert.equal(shot.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await shot.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString("hex"), "89504e47");
});

test("updates status over HTTP", async () => {
  const id = store.list()[0].id;
  const res = await fetch(`${base}/api/requests/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ status: "in_progress", note: "looking" }),
  });
  assert.equal(res.status, 200);
  assert.equal(store.get(id)?.status, "in_progress");
  assert.equal(store.events(id).at(-1)?.note, "looking");
});

test("MCP client can list, read with image, and update", async () => {
  const existing = store.list()[0];
  store.updateStatus(existing.id, "pending", "reset for mcp test");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "mcp"],
    env: {
      ...process.env,
      SITE_INSPECTOR_PROJECT: root,
      SITE_INSPECTOR_PORT: String(port),
    } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "get_project_context",
      "get_request_details",
      "get_request_history",
      "get_screenshot",
      "list_pending_requests",
      "update_request_status",
    ]);

    const listed = (await client.callTool({ name: "list_pending_requests", arguments: {} })) as {
      content: Array<{ type: string; text?: string }>;
    };
    const payload = JSON.parse(listed.content[0].text ?? "{}");
    assert.equal(payload.count, 1);

    const id = payload.requests[0].id as number;
    const details = (await client.callTool({
      name: "get_request_details",
      arguments: { id },
    })) as { content: Array<{ type: string; mimeType?: string }> };
    assert.ok(details.content.some((part) => part.type === "image" && part.mimeType === "image/png"));

    const updated = (await client.callTool({
      name: "update_request_status",
      arguments: { id, status: "awaiting_review", note: "changed Hero.tsx" },
    })) as { content: Array<{ type: string; text?: string }> };
    const updatedPayload = JSON.parse(updated.content[0].text ?? "{}");
    assert.equal(updatedPayload.status, "awaiting_review");

    const detail = store.get(id);
    assert.equal(detail?.status, "awaiting_review");
    if (detail?.screenshots.element) {
      assert.ok(existsSync(store.screenshotPath(detail.screenshots.element)));
    }
  } finally {
    await client.close();
  }
});

async function mcpPost(payload: unknown) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return { status: res.status, json: JSON.parse(line ? line.slice(6) : text) };
}

test("serves MCP over HTTP for clients that only take a URL", async () => {
  const init = await mcpPost({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "http-test", version: "1.0.0" },
    },
  });
  assert.equal(init.status, 200);
  assert.equal(init.json.result.serverInfo.name, "site-inspector");

  const called = await mcpPost({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_project_context", arguments: {} },
  });
  assert.equal(called.status, 200);
  const payload = JSON.parse(called.json.result.content[0].text);
  assert.equal(payload.project.root, store.project().root);
});
