#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { STATUS_LABELS, type RequestStatus } from "../shared/types.ts";
import { VERSION } from "../shared/version.ts";
import { listen } from "./http.ts";
import { runMcpServer } from "./mcp.ts";
import { normalizeRoot } from "./paths.ts";
import {
  DEFAULT_PORT,
  ensureHost,
  probeHost,
  removeRuntime,
  stopHost,
  writeRuntime,
} from "./runtime.ts";
import { Store } from "./store.ts";

type StdioEntry = { command: string; args: string[] };

function help() {
  console.log(`site-inspector ${VERSION}

Usage:
  site-inspector                    Start the local host (same as \`start\`)
  site-inspector start [--root <dir>] [--port <n>]
  site-inspector mcp [--root <dir>] MCP server over stdio. Starts the host if needed.
  site-inspector init [--write] [--force]
                                    Print or write MCP config for this project
  site-inspector status             Show the running host and request counts
  site-inspector stop               Stop the background host
  site-inspector extension [--open] Print the built extension folder
  site-inspector doctor             Diagnose host / config / extension

The extension always talks to 127.0.0.1:${DEFAULT_PORT}. The MCP server and the
HTTP endpoint (http://127.0.0.1:${DEFAULT_PORT}/mcp) use the same host, so you do
not need to start anything before connecting an agent.
`);
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function extensionDir(): string {
  return join(packageRoot(), "dist", "extension");
}

function stdioEntry(): StdioEntry {
  const self = fileURLToPath(import.meta.url);
  if (self.includes(`${sep}node_modules${sep}`)) {
    return { command: "npx", args: ["-y", "site-inspector", "mcp"] };
  }
  return { command: process.execPath, args: [self, "mcp"] };
}

function mcpConfig() {
  return { mcpServers: { "site-inspector": stdioEntry() } };
}

function vscodeConfig() {
  return { servers: { "site-inspector": { type: "stdio", ...stdioEntry() } } };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeConfig(
  target: string,
  key: "mcpServers" | "servers",
  entry: Record<string, unknown>,
  force: boolean,
) {
  mkdirSync(dirname(target), { recursive: true });
  const existing = existsSync(target) ? readJson(target) : null;
  if (existsSync(target) && !existing) {
    console.log(`skip (not valid JSON): ${target}`);
    return;
  }
  const root = existing ?? (force ? {} : {});
  const current = (root[key] as Record<string, unknown> | undefined) ?? {};
  if (!force && current["site-inspector"]) {
    console.log(`already configured: ${target}`);
    return;
  }
  root[key] = { ...current, "site-inspector": entry };
  writeFileSync(target, `${JSON.stringify(root, null, 2)}\n`);
  console.log(`${existing ? "updated" : "wrote"}: ${target}`);
}

function init(root: string, write: boolean, force: boolean) {
  const targets = [
    { file: join(root, ".mcp.json"), key: "mcpServers" as const, entry: stdioEntry() },
    {
      file: join(root, ".cursor", "mcp.json"),
      key: "mcpServers" as const,
      entry: stdioEntry(),
    },
    {
      file: join(root, ".vscode", "mcp.json"),
      key: "servers" as const,
      entry: { type: "stdio", ...stdioEntry() },
    },
  ];

  if (!write) {
    console.log("Claude Code / Cursor (.mcp.json, .cursor/mcp.json):\n");
    console.log(JSON.stringify(mcpConfig(), null, 2));
    console.log("\nVS Code (.vscode/mcp.json):\n");
    console.log(JSON.stringify(vscodeConfig(), null, 2));
    console.log(
      `\nAgents that accept a URL can use the HTTP endpoint instead:\n  http://127.0.0.1:${DEFAULT_PORT}/mcp`,
    );
    console.log("\nWrite them with: site-inspector init --write");
    return;
  }

  for (const target of targets) writeConfig(target.file, target.key, target.entry, force);
  console.log(
    "\nReload your agent. The host starts by itself on the first Inspector call — " +
      `or run \`site-inspector start\` to keep it running. HTTP: http://127.0.0.1:${DEFAULT_PORT}/mcp`,
  );
}

function openFolder(dir: string) {
  const [command, args] =
    process.platform === "win32"
      ? ["explorer.exe", [dir]]
      : process.platform === "darwin"
        ? ["open", [dir]]
        : ["xdg-open", [dir]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" },
      port: { type: "string" },
      write: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", default: false },
    },
  });
  const command = positionals[0] ?? "start";
  const port = Number(values.port ?? process.env.SITE_INSPECTOR_PORT ?? DEFAULT_PORT);
  const root = normalizeRoot(
    values.root ?? process.env.SITE_INSPECTOR_PROJECT ?? process.cwd(),
  );

  if (values.version) {
    console.log(VERSION);
    return;
  }
  if (values.help || command === "help") {
    help();
    return;
  }

  if (command === "init") {
    init(root, Boolean(values.write), Boolean(values.force));
    return;
  }

  if (command === "mcp") {
    const explicitRoot = Boolean(values.root ?? process.env.SITE_INSPECTOR_PROJECT);
    await runMcpServer(root, port, !explicitRoot);
    return;
  }

  if (command === "stop") {
    console.log(await stopHost(port));
    return;
  }

  if (command === "extension") {
    const dir = extensionDir();
    if (!existsSync(join(dir, "manifest.json"))) {
      console.log(`extension is not built yet: ${dir}`);
      console.log("Run: npm run build:ext");
      process.exitCode = 1;
      return;
    }
    console.log(dir);
    if (values.open) openFolder(dir);
    return;
  }

  if (command === "doctor") {
    const health = await probeHost(port);
    console.log(`site-inspector ${VERSION}`);
    console.log(`  node      ${process.version}`);
    console.log(`  cwd       ${process.cwd()}`);
    console.log(`  project   ${health?.project.root ?? root}`);
    console.log(
      health
        ? `  host      running (pid ${health.pid}, ${health.project.root})`
        : `  host      not running on 127.0.0.1:${port} (starts with the agent)`,
    );
    console.log(`  http mcp  http://127.0.0.1:${port}/mcp`);
    const ext = extensionDir();
    console.log(
      `  extension ${existsSync(join(ext, "manifest.json")) ? ext : "not built (npm run build:ext)"}`,
    );
    return;
  }

  if (command === "status") {
    const health = await probeHost(port);
    const store = new Store(health?.project.root ?? root);
    console.log(`project: ${store.project().name} (${store.project().root})`);
    const counts = store.counts();
    for (const status of Object.keys(counts) as RequestStatus[]) {
      console.log(`  ${STATUS_LABELS[status].padEnd(4, "　")} ${counts[status]}`);
    }
    store.close();
    return;
  }

  if (command !== "start") {
    help();
    process.exitCode = 1;
    return;
  }

  const running = await probeHost(port);
  if (running) {
    console.log(`Site Inspector is already running (pid ${running.pid}).`);
    console.log(`  project  ${running.project.root}`);
    console.log(`  listen   http://127.0.0.1:${port}`);
    return;
  }

  const store = new Store(root);
  let server;
  try {
    server = await listen(store, port);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      console.error(
        `port ${port} is already in use — another Site Inspector host is probably running.\n` +
          `Run: site-inspector stop   (or netstat -ano | findstr :${port} to find the PID)`,
      );
      if (port !== DEFAULT_PORT) {
        console.error(
          `Note: the extension always calls 127.0.0.1:${DEFAULT_PORT}, so a custom --port ` +
            `needs the same value in src/extension/background.ts and a rebuild.`,
        );
      }
    } else {
      console.error(error);
    }
    store.close();
    process.exitCode = 1;
    return;
  }

  const project = store.project();
  writeRuntime({ pid: process.pid, port, root: project.root, version: VERSION });
  console.log(`Site Inspector ${VERSION}`);
  console.log(`  project  ${project.root}`);
  console.log(`  data     ${project.dbPath}`);
  console.log(`  listen   http://127.0.0.1:${port}`);
  console.log(`  mcp      http://127.0.0.1:${port}/mcp`);
  console.log("");
  console.log("Open your site and click the Site Inspector icon. Stop with: site-inspector stop");

  const shutdown = () => {
    server?.close();
    store.close();
    removeRuntime(port);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
