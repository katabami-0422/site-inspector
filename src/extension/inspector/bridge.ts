import type {
  CreateRequestInput,
  HealthResponse,
  Rect,
  RequestStatus,
  RequestSummary,
  ViewportInfo,
} from "../../shared/types.ts";

export type CaptureResult = { page: string; element: string };

export type Bridge = {
  health(): Promise<HealthResponse>;
  list(): Promise<RequestSummary[]>;
  create(input: CreateRequestInput): Promise<{ id: number; status: RequestStatus }>;
  capture(rect: Rect, viewport: ViewportInfo): Promise<CaptureResult>;
};

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as
    | Envelope<T>
    | { error: string }
    | undefined;
  if (!response) throw new Error("拡張機能のバックグラウンドから応答がありません");
  if ("ok" in response) {
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }
  if ("error" in response) throw new Error(response.error);
  throw new Error("予期しない応答です");
}

export const chromeBridge: Bridge = {
  health() {
    return call<HealthResponse>({ type: "si:api", method: "GET", path: "/api/health" });
  },
  async list() {
    const data = await call<{ requests: RequestSummary[] }>({
      type: "si:api",
      method: "GET",
      path: "/api/requests?limit=50",
    });
    return data.requests;
  },
  create(input) {
    return call<{ id: number; status: RequestStatus }>({
      type: "si:api",
      method: "POST",
      path: "/api/requests",
      body: input,
    });
  },
  async capture(rect, viewport) {
    const result = await call<CaptureResult>({ type: "si:capture", rect, viewport });
    if (!result?.page || !result?.element) throw new Error("スクリーンショットを取得できませんでした");
    return result;
  },
};
