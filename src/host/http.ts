import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { RequestStatus } from "../shared/types.ts";
import { VERSION } from "../shared/version.ts";
import { createMcpServer } from "./mcp.ts";
import type { Store } from "./store.ts";

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

const statusSchema = z.enum(["pending", "in_progress", "awaiting_review", "done", "redo"]);
const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
const targetSchema = z.object({
  tag: z.string().min(1).max(80),
  id: z.string().max(300).nullable(),
  classes: z.array(z.string().max(200)).max(80),
  selectors: z.array(z.string().min(1).max(500)).min(1).max(20),
  text: z.string().max(4000),
  rect: rectSchema,
  pageRect: rectSchema,
  ancestors: z
    .array(
      z.object({
        tag: z.string().max(80),
        id: z.string().max(300).nullable(),
        classes: z.array(z.string().max(200)).max(80),
        selector: z.string().max(500),
        rect: rectSchema,
      }),
    )
    .max(12),
});
const createSchema = z.object({
  pageUrl: z.string().max(2000),
  pageTitle: z.string().max(300).default(""),
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    dpr: z.number().positive(),
  }),
  element: z.object({
    target: targetSchema,
    styles: z.record(z.string().max(100), z.string().max(4000)),
    html: z.string().max(20000),
  }),
  instruction: z.string().trim().min(1).max(4000),
  intent: z.string().max(2000).optional(),
  scope: z.enum(["element", "component", "page"]),
  priority: z.enum(["low", "normal", "high"]),
  screenshots: z
    .object({ page: z.string().optional(), element: z.string().optional() })
    .optional(),
});
const patchSchema = z.object({
  status: statusSchema,
  note: z.string().max(2000).optional(),
});

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function decodePng(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new HttpError(400, "screenshots must be PNG data URLs");
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(413, "screenshot is too large");
  if (buffer.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new HttpError(400, "screenshot is not a PNG");
  }
  return buffer;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, origin?: string) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.end(payload);
}

function checkHost(req: IncomingMessage) {
  const host = (req.headers.host ?? "").toLowerCase();
  if (!host.startsWith("127.0.0.1:") && !host.startsWith("localhost:")) {
    throw new HttpError(403, "unexpected Host header");
  }
}

/** Browsers always send Origin on cross-origin requests, so a bad Origin means a foreign page. */
function checkOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  if (!origin) return undefined;
  if (!EXTENSION_ORIGIN.test(origin)) throw new HttpError(403, "origin is not a Chrome extension");
  return origin;
}

export function createHostServer(store: Store): Server {
  return createServer(async (req, res) => {
    let origin: string | undefined;
    try {
      checkHost(req);
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      // Universal entry point: agents that support Streamable HTTP only need a URL.
      if (url.pathname === "/mcp") {
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.setHeader("Allow", "POST, GET, DELETE, OPTIONS");
          res.end();
          return;
        }
        const mcp = createMcpServer(async () => store);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          void transport.close().catch(() => {});
          void Promise.resolve(mcp.close()).catch(() => {});
        };
        res.once("close", close);
        await mcp.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      origin = checkOrigin(req);

      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Max-Age", "600");
        res.end();
        return;
      }

      const path = url.pathname;

      if (path === "/api/health" && req.method === "GET") {
        sendJson(
          res,
          200,
          {
            ok: true,
            pid: process.pid,
            version: VERSION,
            project: store.project(),
            counts: store.counts(),
          },
          origin,
        );
        return;
      }

      if (path === "/api/requests" && req.method === "GET") {
        const statusParam = url.searchParams.get("status");
        const statuses = statusParam
          ? (statusParam.split(",").map((s) => s.trim()) as RequestStatus[])
          : undefined;
        const limit = Number(url.searchParams.get("limit") ?? 100);
        sendJson(
          res,
          200,
          {
            requests: store.list({
              statuses,
              pageUrl: url.searchParams.get("pageUrl") ?? undefined,
              limit: Number.isFinite(limit) ? limit : 100,
            }),
          },
          origin,
        );
        return;
      }

      if (path === "/api/requests" && req.method === "POST") {
        if (!origin) throw new HttpError(403, "Origin header is required");
        const parsed = createSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          throw new HttpError(400, `invalid request: ${z.prettifyError(parsed.error)}`);
        }
        const input = parsed.data;
        const shots: { page?: string; element?: string } = {};
        if (input.screenshots?.page) {
          shots.page = store.saveScreenshot(
            `${Date.now()}-${randomUUID().slice(0, 8)}-page.png`,
            decodePng(input.screenshots.page),
          );
        }
        if (input.screenshots?.element) {
          shots.element = store.saveScreenshot(
            `${Date.now()}-${randomUUID().slice(0, 8)}-element.png`,
            decodePng(input.screenshots.element),
          );
        }
        const id = store.create(input, shots);
        sendJson(res, 201, { id, status: "pending" }, origin);
        return;
      }

      const detail = /^\/api\/requests\/(\d+)$/.exec(path);
      if (detail) {
        const id = Number(detail[1]);
        if (req.method === "GET") {
          const request = store.get(id);
          if (!request) throw new HttpError(404, "request not found");
          sendJson(res, 200, { request, events: store.events(id) }, origin);
          return;
        }
        if (req.method === "PATCH") {
          if (!origin) throw new HttpError(403, "Origin header is required");
          const parsed = patchSchema.safeParse(await readJson(req));
          if (!parsed.success) {
            throw new HttpError(400, `invalid patch: ${z.prettifyError(parsed.error)}`);
          }
          const updated = store.updateStatus(id, parsed.data.status, parsed.data.note);
          if (!updated) throw new HttpError(404, "request not found");
          sendJson(res, 200, { request: updated }, origin);
          return;
        }
      }

      const shot = /^\/api\/requests\/(\d+)\/screenshot$/.exec(path);
      if (shot && req.method === "GET") {
        const id = Number(shot[1]);
        const request = store.get(id);
        if (!request) throw new HttpError(404, "request not found");
        const kind = url.searchParams.get("kind") === "page" ? "page" : "element";
        const fileName = request.screenshots[kind];
        if (!fileName) throw new HttpError(404, "screenshot not found");
        const png = readFileSync(store.screenshotPath(fileName));
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        if (origin) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
        }
        res.end(png);
        return;
      }

      throw new HttpError(404, "not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "internal error";
      if (status >= 500) console.error("[site-inspector]", error);
      if (!res.headersSent) sendJson(res, status, { error: message }, origin);
      else res.end();
    }
  });
}

export function listen(store: Store, port: number): Promise<Server> {
  const server = createHostServer(store);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
