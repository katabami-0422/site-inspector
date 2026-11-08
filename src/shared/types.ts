export type RequestStatus =
  | "pending"
  | "in_progress"
  | "awaiting_review"
  | "done"
  | "redo";

export type Scope = "element" | "component" | "page";
export type Priority = "low" | "normal" | "high";

export const REQUEST_STATUSES: RequestStatus[] = [
  "pending",
  "in_progress",
  "awaiting_review",
  "done",
  "redo",
];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "未対応",
  in_progress: "対応中",
  awaiting_review: "確認待ち",
  done: "完了",
  redo: "再修正",
};

export const SCOPE_LABELS: Record<Scope, string> = {
  element: "この要素のみ",
  component: "同じコンポーネント",
  page: "ページ全体",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "低",
  normal: "標準",
  high: "高",
};

export type Rect = { x: number; y: number; width: number; height: number };
export type ViewportInfo = { width: number; height: number; dpr: number };

export type AncestorInfo = {
  tag: string;
  id: string | null;
  classes: string[];
  selector: string;
  rect: Rect;
};

export type TargetInfo = {
  tag: string;
  id: string | null;
  classes: string[];
  /** unique-first list; later entries are fallbacks after re-render */
  selectors: string[];
  text: string;
  rect: Rect;
  pageRect: Rect;
  ancestors: AncestorInfo[];
};

export type ElementInfo = {
  target: TargetInfo;
  styles: Record<string, string>;
  html: string;
};

export type CreateRequestInput = {
  pageUrl: string;
  pageTitle: string;
  viewport: ViewportInfo;
  element: ElementInfo;
  instruction: string;
  intent?: string;
  scope: Scope;
  priority: Priority;
  screenshots?: {
    page?: string;
    element?: string;
  };
};

export type RequestSummary = {
  id: number;
  status: RequestStatus;
  instruction: string;
  pageUrl: string;
  createdAt: string;
  updatedAt: string;
  target: { tag: string; selector: string; selectors: string[]; text: string };
  hasScreenshot: boolean;
};

export type StoredRequest = {
  id: number;
  status: RequestStatus;
  pageUrl: string;
  pageTitle: string;
  instruction: string;
  intent: string;
  scope: Scope;
  priority: Priority;
  element: ElementInfo;
  viewport: ViewportInfo;
  screenshots: { page: string | null; element: string | null };
  createdAt: string;
  updatedAt: string;
};

export type ProjectInfo = {
  name: string;
  root: string;
  dataDir: string;
  dbPath: string;
  createdAt: string;
};

export type HealthResponse = {
  ok: true;
  version: string;
  project: ProjectInfo;
  counts: Record<RequestStatus, number>;
};
