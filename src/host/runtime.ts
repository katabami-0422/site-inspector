import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectInfo } from "../shared/types.ts";
import { runtimeFile } from "./paths.ts";

export const DEFAULT_PORT = 3847;

export type HostHealth = {
  ok: true;
  pid: number;
  version: string;
  project: ProjectInfo;
  counts: Record<string, number>;
};

export type HostRuntime = {
  pid: number;
  port: number;
  root: string;
  version: string;
  startedAt: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function probeHost(port = DEFAULT_PORT, timeoutMs = 600): Promise<HostHealth | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<HostHealth>;
    return data.ok && data.project ? (data as HostHealth) : null;
  } catch {
    return null;
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(400, () => done(false));
  });
}

function cliEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const js = join(here, "cli.js");
  return existsSync(js) ? js : join(here, "cli.ts");
}

/**
 * Returns a running host, starting a detached one when none is listening.
 * The running host's project root wins: it is the root the extension writes to.
 */
export async function ensureHost(
  root: string,
  port = DEFAULT_PORT,
): Promise<{ health: HostHealth; root: string; spawned: boolean }> {
  const running = await probeHost(port);
  if (running) return { health: running, root: running.project.root, spawned: false };

  if (await portOpen(port)) {
    throw new Error(
      `127.0.0.1:${port} is already in use by another app. ` +
        `Stop it, or change the port in both the host and the extension.`,
    );
  }

  const child = spawn(
    process.execPath,
    [cliEntry(), "start", "--root", root, "--port", String(port)],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: root,
      env: process.env,
    },
  );
  child.unref();

  for (let i = 0; i < 80; i++) {
    const health = await probeHost(port, 300);
    if (health) return { health, root: health.project.root, spawned: true };
    await sleep(100);
  }

  throw new Error(
    `Site Inspector host did not start on 127.0.0.1:${port}. ` +
      `Run "site-inspector start --root ${root}" to see the error.`,
  );
}

export function readRuntime(port = DEFAULT_PORT): HostRuntime | null {
  try {
    const data = JSON.parse(readFileSync(runtimeFile(port), "utf8")) as Partial<HostRuntime>;
    if (typeof data.pid !== "number" || data.port !== port) return null;
    return data as HostRuntime;
  } catch {
    return null;
  }
}

export function writeRuntime(info: Omit<HostRuntime, "startedAt">): void {
  try {
    writeFileSync(
      runtimeFile(info.port),
      `${JSON.stringify({ ...info, startedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch {
    // the host still works without the marker file
  }
}

export function removeRuntime(port = DEFAULT_PORT): void {
  try {
    rmSync(runtimeFile(port), { force: true });
  } catch {
    // ignore
  }
}

export async function stopHost(port = DEFAULT_PORT): Promise<string> {
  const health = await probeHost(port);
  if (!health) {
    removeRuntime(port);
    return `nothing is listening on 127.0.0.1:${port}`;
  }
  if (health.pid === process.pid) return "refusing to stop the current process";

  try {
    process.kill(health.pid);
  } catch (error) {
    return `could not stop pid ${health.pid}: ${(error as Error).message}`;
  }

  for (let i = 0; i < 30; i++) {
    await sleep(100);
    if (!(await probeHost(port, 200))) {
      removeRuntime(port);
      return `stopped Site Inspector host (pid ${health.pid}, root ${health.project.root})`;
    }
  }
  return `sent stop to pid ${health.pid}, but 127.0.0.1:${port} is still answering`;
}
