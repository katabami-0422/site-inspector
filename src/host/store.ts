import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CreateRequestInput,
  ElementInfo,
  Priority,
  ProjectInfo,
  RequestStatus,
  RequestSummary,
  Scope,
  StoredRequest,
  ViewportInfo,
} from "../shared/types.ts";
import { REQUEST_STATUSES } from "../shared/types.ts";
import { projectPaths } from "./paths.ts";

type RequestRow = {
  id: number;
  status: RequestStatus;
  page_url: string;
  page_title: string;
  instruction: string;
  intent: string;
  scope: Scope;
  priority: Priority;
  target_json: string;
  styles_json: string;
  dom_html: string;
  viewport_json: string;
  screenshot_page: string | null;
  screenshot_element: string | null;
  created_at: string;
  updated_at: string;
};

export type ListFilter = {
  statuses?: RequestStatus[];
  pageUrl?: string;
  limit?: number;
};

export class Store {
  readonly paths: ReturnType<typeof projectPaths>;
  private db: DatabaseSync;

  constructor(root: string) {
    this.paths = projectPaths(root);
    this.db = new DatabaseSync(this.paths.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        page_url TEXT NOT NULL,
        page_title TEXT NOT NULL DEFAULT '',
        instruction TEXT NOT NULL,
        intent TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL,
        priority TEXT NOT NULL,
        target_json TEXT NOT NULL,
        styles_json TEXT NOT NULL,
        dom_html TEXT NOT NULL DEFAULT '',
        viewport_json TEXT NOT NULL,
        screenshot_page TEXT,
        screenshot_element TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, id DESC);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL REFERENCES requests(id),
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
    `);

    const info = this.paths;
    const now = new Date().toISOString();
    const put = this.db.prepare(
      "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING",
    );
    put.run("root", info.root);
    put.run("name", basename(info.root) || info.root);
    put.run("created_at", now);
    put.run("schema_version", "1");
  }

  private meta(key: string): string {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? "";
  }

  project(): ProjectInfo {
    return {
      name: this.meta("name"),
      root: this.meta("root"),
      dataDir: this.paths.dir,
      dbPath: this.paths.dbPath,
      createdAt: this.meta("created_at"),
    };
  }

  create(input: CreateRequestInput, shots?: { page?: string; element?: string }): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO requests
          (status, page_url, page_title, instruction, intent, scope, priority,
           target_json, styles_json, dom_html, viewport_json,
           screenshot_page, screenshot_element, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "pending",
        input.pageUrl,
        input.pageTitle,
        input.instruction,
        input.intent ?? "",
        input.scope,
        input.priority,
        JSON.stringify(input.element.target),
        JSON.stringify(input.element.styles),
        input.element.html,
        JSON.stringify(input.viewport),
        shots?.page ?? null,
        shots?.element ?? null,
        now,
        now,
      );

    const id = Number(result.lastInsertRowid);
    this.addEvent(id, "pending", "created");
    return id;
  }

  private addEvent(requestId: number, status: RequestStatus, note: string) {
    this.db
      .prepare("INSERT INTO events(request_id, status, note, created_at) VALUES(?, ?, ?, ?)")
      .run(requestId, status, note, new Date().toISOString());
  }

  /** Writes a PNG into the project's shots dir and returns the file name. */
  saveScreenshot(fileName: string, png: Buffer): string {
    writeFileSync(join(this.paths.shots, fileName), png);
    return fileName;
  }

  screenshotPath(fileName: string): string {
    return join(this.paths.shots, fileName);
  }

  list(filter: ListFilter = {}): RequestSummary[] {
    const statuses = filter.statuses?.length ? filter.statuses : null;
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (statuses) {
      conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
    if (filter.pageUrl) {
      conditions.push("page_url = ?");
      params.push(filter.pageUrl);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT id, status, instruction, page_url, target_json, screenshot_page,
                screenshot_element, created_at, updated_at
         FROM requests ${where} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params, limit) as unknown as Array<{
      id: number;
      status: RequestStatus;
      instruction: string;
      page_url: string;
      target_json: string;
      screenshot_page: string | null;
      screenshot_element: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const target = JSON.parse(row.target_json) as ElementInfo["target"];
      return {
        id: row.id,
        status: row.status,
        instruction: row.instruction,
        pageUrl: row.page_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        target: {
          tag: target.tag,
          selector: target.selectors[0] ?? target.tag,
          selectors: target.selectors,
          text: target.text,
        },
        hasScreenshot: Boolean(row.screenshot_page || row.screenshot_element),
      };
    });
  }

  get(id: number): StoredRequest | null {
    const row = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as
      | RequestRow
      | undefined;
    if (!row) return null;

    return {
      id: row.id,
      status: row.status,
      pageUrl: row.page_url,
      pageTitle: row.page_title,
      instruction: row.instruction,
      intent: row.intent,
      scope: row.scope,
      priority: row.priority,
      element: {
        target: JSON.parse(row.target_json),
        styles: JSON.parse(row.styles_json),
        html: row.dom_html,
      },
      viewport: JSON.parse(row.viewport_json) as ViewportInfo,
      screenshots: { page: row.screenshot_page, element: row.screenshot_element },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateStatus(id: number, status: RequestStatus, note = ""): StoredRequest | null {
    if (!REQUEST_STATUSES.includes(status)) {
      throw new Error(`unknown status: ${status}`);
    }
    const existing = this.get(id);
    if (!existing) return null;

    this.db
      .prepare("UPDATE requests SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
    this.addEvent(id, status, note);
    return this.get(id);
  }

  history(limit = 50) {
    return this.list({ limit });
  }

  events(requestId: number) {
    return this.db
      .prepare("SELECT status, note, created_at FROM events WHERE request_id = ? ORDER BY id")
      .all(requestId) as unknown as Array<{ status: RequestStatus; note: string; created_at: string }>;
  }

  counts(): Record<RequestStatus, number> {
    const counts = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<
      RequestStatus,
      number
    >;
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM requests GROUP BY status")
      .all() as unknown as Array<{ status: RequestStatus; n: number }>;
    for (const row of rows) counts[row.status] = Number(row.n);
    return counts;
  }

  pages() {
    return this.db
      .prepare(
        `SELECT page_url, MAX(updated_at) AS last_seen, COUNT(*) AS n
         FROM requests GROUP BY page_url ORDER BY last_seen DESC LIMIT 20`,
      )
      .all() as unknown as Array<{ page_url: string; last_seen: string; n: number }>;
  }

  close() {
    this.db.close();
  }
}
