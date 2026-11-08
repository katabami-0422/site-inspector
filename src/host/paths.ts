import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const APP_DIR = "site-inspector";

export function dataRoot(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_DIR);
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIR);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_DIR);
}

export function runtimeFile(port: number): string {
  return join(dataRoot(), `host-${port}.json`);
}

export function normalizeRoot(input: string): string {
  const absolute = resolve(input);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

export function projectPaths(rootInput: string) {
  const root = normalizeRoot(rootInput);
  const keySource = process.platform === "win32" ? root.toLowerCase() : root;
  const key = createHash("sha1").update(keySource).digest("hex").slice(0, 12);
  const dir = join(dataRoot(), "projects", key);
  const shots = join(dir, "shots");
  mkdirSync(shots, { recursive: true });
  return { root, key, dir, shots, dbPath: join(dir, "inspector.db") };
}
