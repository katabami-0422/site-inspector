import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { RequestStatus } from "../shared/types.ts";
import { VERSION } from "../shared/version.ts";
import { WORKFLOW } from "./instructions.ts";
import { normalizeRoot } from "./paths.ts";
import { ensureHost } from "./runtime.ts";
import { Store } from "./store.ts";

const statusSchema = z.enum(["pending", "in_progress", "awaiting_review", "done", "redo"]);

export type StoreGetter = () => Promise<Store>;

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function imageContent(store: Store, fileName: string | null | undefined) {
  if (!fileName) return null;
  try {
    return {
      type: "image" as const,
      data: readFileSync(store.screenshotPath(fileName)).toString("base64"),
      mimeType: "image/png",
    };
  } catch {
    return null;
  }
}

export function registerTools(server: McpServer, getStore: StoreGetter) {
  server.registerTool(
    "list_pending_requests",
    {
      title: "List pending Site Inspector requests",
      description:
        "List fix requests submitted from the browser. Defaults to open requests (pending + redo). " +
        "Call get_request_details for each id before editing code.",
      inputSchema: {
        status: z
          .enum(["open", "pending", "redo", "in_progress", "awaiting_review", "all"])
          .optional()
          .describe("open = pending + redo (default), all = every status"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ status = "open", limit = 20 }) => {
      const store = await getStore();
      let statuses: RequestStatus[] | undefined;
      if (status === "open") statuses = ["pending", "redo"];
      else if (status !== "all") statuses = [status];
      const requests = store.list({ statuses, limit });
      return {
        content: [
          {
            type: "text",
            text: json({
              count: requests.length,
              counts: store.counts(),
              requests,
              workflow: WORKFLOW,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_request_details",
    {
      title: "Get one Site Inspector request",
      description:
        "Return the full request: instruction, intent, scope, target element info, computed styles, " +
        "HTML snippet and screenshots (element crop + viewport). Use this before changing code.",
      inputSchema: {
        id: z.number().int().positive(),
        include_screenshot: z.boolean().optional().describe("default true"),
      },
    },
    async ({ id, include_screenshot = true }) => {
      const store = await getStore();
      const request = store.get(id);
      if (!request) {
        return { isError: true, content: [{ type: "text", text: `request ${id} not found` }] };
      }
      const content: Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      > = [
        {
          type: "text",
          text: json({
            request,
            events: store.events(id),
            guidance:
              "Locate the source by the selectors, text and class names. Keep the change minimal and respect `scope`.",
          }),
        },
      ];
      if (include_screenshot) {
        const element = imageContent(store, request.screenshots.element);
        const page = imageContent(store, request.screenshots.page);
        if (element) content.push(element);
        if (page) content.push(page);
      }
      return { content };
    },
  );

  server.registerTool(
    "get_screenshot",
    {
      title: "Get screenshots for a request",
      description: "Return the element crop and/or the viewport screenshot as PNG images.",
      inputSchema: {
        id: z.number().int().positive(),
        kind: z.enum(["element", "page", "both"]).optional(),
      },
    },
    async ({ id, kind = "both" }) => {
      const store = await getStore();
      const request = store.get(id);
      if (!request) {
        return { isError: true, content: [{ type: "text", text: `request ${id} not found` }] };
      }
      const content: Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      > = [];
      if (kind !== "page") {
        const element = imageContent(store, request.screenshots.element);
        if (element) content.push(element);
      }
      if (kind !== "element") {
        const page = imageContent(store, request.screenshots.page);
        if (page) content.push(page);
      }
      if (content.length === 0) {
        content.push({ type: "text", text: `request ${id} has no screenshots` });
      }
      return { content };
    },
  );

  server.registerTool(
    "update_request_status",
    {
      title: "Update request status",
      description:
        "Move a request through pending → in_progress → awaiting_review → done (or redo). " +
        "Set awaiting_review after editing code so the user can check the result.",
      inputSchema: {
        id: z.number().int().positive(),
        status: statusSchema,
        note: z.string().max(2000).optional().describe("short note, e.g. changed src/components/Hero.tsx"),
      },
    },
    async ({ id, status, note }) => {
      const store = await getStore();
      const updated = store.updateStatus(id, status, note ?? "");
      if (!updated) {
        return { isError: true, content: [{ type: "text", text: `request ${id} not found` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: json({ id: updated.id, status: updated.status, counts: store.counts() }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get project context",
      description:
        "Project root, request counts, recently inspected pages and the workflow instructions.",
      inputSchema: {},
    },
    async () => {
      const store = await getStore();
      return {
        content: [
          {
            type: "text",
            text: json({
              project: store.project(),
              counts: store.counts(),
              pages: store.pages(),
              workflow: WORKFLOW,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_request_history",
    {
      title: "Get request history",
      description: "Recent requests in every status (most recent first).",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ limit = 30 }) => {
      const store = await getStore();
      return { content: [{ type: "text", text: json({ requests: store.history(limit) }) }] };
    },
  );
}

export function createMcpServer(getStore: StoreGetter): McpServer {
  const server = new McpServer({ name: "site-inspector", version: VERSION });
  registerTools(server, getStore);
  return server;
}

async function clientRoot(server: McpServer): Promise<string | null> {
  if (!server.server.getClientCapabilities()?.roots) return null;
  try {
    const result = await server.server.listRoots(undefined, { timeout: 800 });
    for (const root of result.roots) {
      if (root.uri.startsWith("file://")) return normalizeRoot(fileURLToPath(root.uri));
    }
  } catch {
    // client did not answer roots/list — fall back to cwd
  }
  return null;
}

/**
 * The store is opened on the first tool call, after the MCP handshake, so the
 * project root can come from the client (roots/list) or from the running host.
 */
export async function runMcpServer(initialRoot: string, port: number, useClientRoots = true) {
  const server = new McpServer({ name: "site-inspector", version: VERSION });
  let opening: Promise<Store> | null = null;

  const open = async () => {
    let root = initialRoot;
    if (useClientRoots) root = (await clientRoot(server)) ?? root;
    const { health } = await ensureHost(root, port);
    if (health.project.root !== root) {
      console.error(
        `[site-inspector] using the running host's project: ${health.project.root}`,
      );
    }
    return new Store(health.project.root);
  };
  const getStore: StoreGetter = () => (opening ??= open());

  registerTools(server, getStore);
  await server.connect(new StdioServerTransport());
}
