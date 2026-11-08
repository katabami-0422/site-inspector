import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PRIORITY_LABELS,
  SCOPE_LABELS,
  STATUS_LABELS,
  type CreateRequestInput,
  type ElementInfo,
  type Priority,
  type ProjectInfo,
  type Rect,
  type RequestStatus,
  type RequestSummary,
  type Scope,
} from "../../shared/types.ts";
import type { Bridge } from "./bridge.ts";
import { inspectorBus } from "./events.ts";
import {
  extractElementInfo,
  isInspectorNode,
  labelFor,
  nearestHtml,
  resolveSelectors,
  toRect,
} from "./inspect.ts";

const ACTIVE_KEY = "si:active";
const SELECTION_KEY = "si:selection";
const OPEN_STATUSES: RequestStatus[] = ["pending", "redo", "in_progress", "awaiting_review"];

type Draft = {
  instruction: string;
  intent: string;
  scope: Scope;
  priority: Priority;
  includeShot: boolean;
};

type Selection = { el: HTMLElement; info: ElementInfo };
type Marker = { id: number; status: RequestStatus; rect: Rect; selectors: string[] };
type SentInfo = { id: number; screenshot: boolean };
type Connection = "checking" | "ok" | "down";

const emptyDraft = (): Draft => ({
  instruction: "",
  intent: "",
  scope: "element",
  priority: "normal",
  includeShot: true,
});

const QUICK_ACTIONS: Array<[string, string]> = [
  ["サイズ変更", "サイズ変更："],
  ["色変更", "色変更："],
  ["余白調整", "余白調整："],
  ["配置調整", "配置調整："],
  ["フォント変更", "フォント変更："],
  ["アニメーション追加", "アニメーション追加："],
  ["スマートフォン対応", "スマートフォン対応："],
];

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // storage may be blocked on some pages
  }
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "たった今";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function labelPosition(rect: Rect): { left: number; top: number } {
  return {
    left: Math.min(Math.max(rect.x + 16, 4), Math.max(4, window.innerWidth - 320)),
    top: rect.y > 28 ? rect.y - 24 : rect.y + rect.height + 4,
  };
}

export function App({ host, bridge }: { host: HTMLElement; bridge: Bridge }) {
  const [active, setActive] = useState(() => readSession(ACTIVE_KEY) === "1");
  const [hover, setHover] = useState<{ rect: Rect; label: string } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<"compose" | "list">("compose");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [connection, setConnection] = useState<Connection>("checking");
  const [preview, setPreview] = useState<{ page?: string; element?: string } | null>(null);
  const [captureState, setCaptureState] = useState<"idle" | "capturing" | "failed">("idle");
  const [captureError, setCaptureError] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendError, setSendError] = useState("");
  const [sentInfo, setSentInfo] = useState<SentInfo | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [toast, setToast] = useState("");
  const [, setViewportTick] = useState(0);
  const hoveredEl = useRef<HTMLElement | null>(null);

  const selectionKey = selection?.info.target.selectors[0] ?? "";
  const draft = (selectionKey ? drafts[selectionKey] : undefined) ?? emptyDraft();
  const openCount = useMemo(
    () => requests.filter((request) => OPEN_STATUSES.includes(request.status)).length,
    [requests],
  );

  const selectElement = useCallback(
    (el: HTMLElement | null, options: { tab?: "compose" | "list"; open?: boolean } = {}) => {
      if (!el || isInspectorNode(el) || el === document.documentElement || el === document.body) return;
      let info: ElementInfo;
      try {
        info = extractElementInfo(el);
      } catch {
        return;
      }
      setSelection({ el, info });
      setPanelOpen(options.open ?? true);
      if (options.tab) setTab(options.tab);
      setPreview(null);
      setSentInfo(null);
      setSendState("idle");
      setSendError("");
      writeSession(
        SELECTION_KEY,
        JSON.stringify({ url: location.href, selectors: info.target.selectors }),
      );
    },
    [],
  );

  const updateDraft = useCallback(
    (patch: Partial<Draft>) => {
      if (!selectionKey) return;
      setDrafts((current) => ({
        ...current,
        [selectionKey]: { ...(current[selectionKey] ?? emptyDraft()), ...patch },
      }));
      setSentInfo(null);
    },
    [selectionKey],
  );

  const refresh = useCallback(async () => {
    try {
      const [health, list] = await Promise.all([bridge.health(), bridge.list()]);
      setProject(health.project);
      setRequests(list);
      setConnection("ok");
    } catch {
      setConnection("down");
    }
  }, [bridge]);

  const capture = useCallback(async () => {
    if (!selection) return null;
    const rect = toRect(selection.el.getBoundingClientRect());
    setCaptureState("capturing");
    setCaptureError("");
    host.style.visibility = "hidden";
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)));
      });
      const shots = await bridge.capture(rect, {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      });
      setPreview(shots);
      setCaptureState("idle");
      return shots;
    } catch (error) {
      setCaptureState("failed");
      setCaptureError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      host.style.visibility = "";
    }
  }, [bridge, host, selection]);

  const send = useCallback(async () => {
    if (!selection || !selectionKey) return;
    const instruction = draft.instruction.trim();
    if (!instruction) return;

    setSendState("sending");
    setSendError("");
    let shots = draft.includeShot ? preview : null;
    if (draft.includeShot && !shots) shots = await capture();

    try {
      const fresh = extractElementInfo(selection.el);
      const payload: CreateRequestInput = {
        pageUrl: location.href,
        pageTitle: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          dpr: window.devicePixelRatio,
        },
        element: fresh,
        instruction,
        intent: draft.intent.trim() || undefined,
        scope: draft.scope,
        priority: draft.priority,
        screenshots: shots ? { page: shots.page, element: shots.element } : undefined,
      };
      const created = await bridge.create(payload);
      setSentInfo({ id: created.id, screenshot: Boolean(shots) });
      setSendState("sent");
      setDrafts((current) => ({ ...current, [selectionKey]: emptyDraft() }));
      setPreview(null);
      await refresh();
    } catch (error) {
      setSendState("error");
      setSendError(error instanceof Error ? error.message : String(error));
    }
  }, [bridge, capture, draft, preview, refresh, selection, selectionKey]);

  const chooseParent = useCallback(() => {
    if (!selection) return;
    const parent = selection.el.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) selectElement(parent);
  }, [selectElement, selection]);

  const chooseChild = useCallback(() => {
    if (!selection) return;
    const rect = selection.el.getBoundingClientRect();
    const atCenter = nearestHtml(
      document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
    );
    if (
      atCenter &&
      atCenter !== selection.el &&
      selection.el.contains(atCenter) &&
      !isInspectorNode(atCenter)
    ) {
      selectElement(atCenter);
      return;
    }
    const firstChild = Array.from(selection.el.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && !isInspectorNode(child),
    );
    if (firstChild) selectElement(firstChild);
  }, [selectElement, selection]);

  const deselect = useCallback(() => {
    setSelection(null);
    setPanelOpen(false);
    setPreview(null);
    setSentInfo(null);
    setSendState("idle");
    writeSession(SELECTION_KEY, null);
  }, []);

  const handlers = useRef({
    selectElement,
    chooseChild,
    chooseParent,
    send,
    selection,
    panelOpen,
  });
  handlers.current = { selectElement, chooseChild, chooseParent, send, selection, panelOpen };

  useEffect(() => {
    const onToggle = () => {
      setActive((current) => {
        const next = !current;
        writeSession(ACTIVE_KEY, next ? "1" : "0");
        return next;
      });
    };
    inspectorBus.addEventListener("toggle", onToggle);
    return () => inspectorBus.removeEventListener("toggle", onToggle);
  }, []);

  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) {
      setHover(null);
      setSelection(null);
      setPanelOpen(false);
      writeSession(SELECTION_KEY, null);
    }
    wasActive.current = active;
  }, [active]);

  const restored = useRef(false);
  useEffect(() => {
    if (!active || restored.current) return;
    restored.current = true;
    const raw = readSession(SELECTION_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { url?: string; selectors?: string[] };
      if (saved.url !== location.href || !saved.selectors) return;
      const el = resolveSelectors(saved.selectors);
      if (el) selectElement(el);
    } catch {
      // ignore broken storage
    }
  }, [active, selectElement]);

  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  useEffect(() => {
    if (active && tab === "list") refresh();
  }, [active, tab, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const onViewportChange = () => {
      setHover(null);
      hoveredEl.current = null;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewportTick((tick) => tick + 1));
    };
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      setMarkers([]);
      return;
    }
    const compute = () => {
      const next: Marker[] = [];
      for (const request of requests) {
        if (!OPEN_STATUSES.includes(request.status)) continue;
        if (request.pageUrl !== location.href) continue;
        const el = resolveSelectors(request.target.selectors);
        if (!el) continue;
        const rect = toRect(el.getBoundingClientRect());
        if (rect.width < 1 || rect.height < 1) continue;
        next.push({
          id: request.id,
          status: request.status,
          rect,
          selectors: request.target.selectors,
        });
      }
      setMarkers(next);
    };
    compute();
    const onScroll = () => compute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [active, requests]);

  useEffect(() => {
    if (!active) return;

    const onMove = (event: MouseEvent) => {
      const el = nearestHtml(document.elementFromPoint(event.clientX, event.clientY));
      if (!el || isInspectorNode(el) || el === document.documentElement || el === document.body) {
        hoveredEl.current = null;
        setHover(null);
        return;
      }
      if (hoveredEl.current === el) return;
      hoveredEl.current = el;
      setHover({ rect: toRect(el.getBoundingClientRect()), label: labelFor(el) });
    };

    const onClick = (event: MouseEvent) => {
      if (event.composedPath().some((node) => node instanceof HTMLElement && node.hasAttribute("data-site-inspector"))) {
        return;
      }
      const el = nearestHtml(document.elementFromPoint(event.clientX, event.clientY));
      if (!el || isInspectorNode(el) || el === document.documentElement) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.current.selectElement(el);
    };

    const onKey = (event: KeyboardEvent) => {
      const insideUi =
        event.target instanceof Node &&
        event.composedPath().some((node) => node instanceof HTMLElement && node.hasAttribute("data-site-inspector"));

      if (event.key === "Escape") {
        if (event.shiftKey) {
          setActive(false);
          writeSession(ACTIVE_KEY, "0");
        } else if (handlers.current.selection) {
          setSelection(null);
          setPanelOpen(false);
          writeSession(SELECTION_KEY, null);
        }
        return;
      }

      if (!handlers.current.selection) return;

      if (event.altKey && !insideUi && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        if (event.key === "ArrowUp") handlers.current.chooseParent();
        else handlers.current.chooseChild();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && handlers.current.panelOpen) {
        event.preventDefault();
        handlers.current.send();
      }
    };

    window.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active]);

  if (!active) return null;

  const instructionReady = draft.instruction.trim().length > 0;
  const selectedRect = selection ? toRect(selection.el.getBoundingClientRect()) : null;

  return (
    <>
      {hover && <div className="si-outline si-outline--hover" style={hoverStyle(hover.rect)} />}
      {hover && (
        <div className="si-tag" style={labelPosition(hover.rect)}>
          {hover.label}
        </div>
      )}

      {selection && selectedRect && (
        <>
          <div className="si-outline si-outline--selected" style={hoverStyle(selectedRect)} />
          <div className="si-tag si-tag--accent" style={labelPosition(selectedRect)}>
            選択中 · {selection.info.target.tag}
            {selection.info.target.classes[0] ? `.${selection.info.target.classes[0]}` : ""}
          </div>
        </>
      )}

      {markers.map((marker) => (
        <button
          key={marker.id}
          type="button"
          className={`si-marker si-marker--${marker.status}`}
          style={{ left: marker.rect.x - 10, top: marker.rect.y - 10 }}
          title={`依頼 #${marker.id}（${STATUS_LABELS[marker.status]}）を選択`}
          onClick={() => {
            const el = resolveSelectors(marker.selectors);
            if (el) selectElement(el, { tab: "list" });
            else setToast("対象の要素が見つかりませんでした");
          }}
        >
          {marker.id}
        </button>
      ))}

      {panelOpen && selection && (
        <aside className="si-panel" aria-label="Site Inspector">
              <header className="si-header">
                <span className="si-mark" aria-hidden="true" />
                <span className="si-heading">
                  <strong className="si-title">Site Inspector</strong>
                  <span className="si-sub">
                    {connection === "ok" ? project?.name ?? "接続済み" : connection === "down" ? "未接続" : "確認中"}
                  </span>
                </span>
                <span
                  className={`si-conn si-conn--${connection}`}
                  title={connection === "ok" ? "ローカルホストに接続済み" : "ローカルホストに接続できません"}
                />
                <button
                  type="button"
                  className="si-icon"
                  aria-label="パネルを閉じる"
                  title="閉じる（Esc）"
                  onClick={() => setPanelOpen(false)}
                >
                  ×
                </button>
              </header>

              <div className="si-tabs" role="tablist" aria-label="表示">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "compose"}
                  className="si-tab"
                  onClick={() => setTab("compose")}
                >
                  依頼
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "list"}
                  className="si-tab"
                  onClick={() => setTab("list")}
                >
                  一覧
                  {openCount > 0 && <span className="si-count">{openCount}</span>}
                </button>
              </div>

              <div className="si-body">
                {tab === "compose" ? (
                  <>
                    {connection === "down" && (
                      <p className="si-banner si-banner--error" role="status">
                        AI エージェントに Site Inspector の MCP を追加すると、ローカルホストは自動で起動します。手動で起動する場合は
                        <code>npx site-inspector start</code>
                        を実行してください。
                      </p>
                    )}

                    <section className="si-element" aria-label="選択中の要素">
                      <div className="si-element-head">
                        <code className="si-code">
                          {selection.info.target.tag}
                          {selection.info.target.classes[0]
                            ? `.${selection.info.target.classes[0]}`
                            : ""}
                        </code>
                        <span className="si-meta">
                          {Math.round(selectedRect?.width ?? 0)}×{Math.round(selectedRect?.height ?? 0)}
                          {selection.info.styles["font-size"]
                            ? ` · ${selection.info.styles["font-size"]}`
                            : ""}
                        </span>
                      </div>
                      {selection.info.target.text && (
                        <p className="si-text">“{selection.info.target.text}”</p>
                      )}
                      <div className="si-row">
                        <button type="button" className="si-mini" onClick={chooseParent}>
                          ↑ 親
                        </button>
                        <button type="button" className="si-mini" onClick={chooseChild}>
                          ↓ 子
                        </button>
                        <button type="button" className="si-mini si-mini--quiet" onClick={deselect}>
                          選択解除
                        </button>
                      </div>
                      <details className="si-details">
                        <summary>セレクタとスタイル</summary>
                        <ul className="si-list">
                          {selection.info.target.selectors.map((selector) => (
                            <li key={selector}>
                              <code>{selector}</code>
                            </li>
                          ))}
                        </ul>
                        <dl className="si-styles">
                          {[
                            "display",
                            "position",
                            "font-size",
                            "line-height",
                            "color",
                            "background-color",
                            "padding",
                            "margin",
                            "gap",
                            "border-radius",
                          ]
                            .filter((prop) => selection.info.styles[prop])
                            .map((prop) => (
                              <div key={prop}>
                                <dt>{prop}</dt>
                                <dd>{selection.info.styles[prop]}</dd>
                              </div>
                            ))}
                        </dl>
                      </details>
                    </section>

                    {sentInfo && (
                      <p className="si-banner si-banner--success" role="status">
                        依頼 #{sentInfo.id} を送信しました。
                        {!sentInfo.screenshot && "（スクリーンショットなし）"}
                        <button type="button" className="si-link" onClick={() => setTab("list")}>
                          一覧を見る
                        </button>
                      </p>
                    )}

                    <label className="si-label" htmlFor="si-instruction">
                      修正内容
                    </label>
                    <textarea
                      id="si-instruction"
                      className="si-textarea"
                      rows={4}
                      value={draft.instruction}
                      placeholder="例：文字を少し小さくして、文字間隔を広げてほしい。スマートフォンでは現在のサイズを維持して。"
                      onChange={(event) => updateDraft({ instruction: event.target.value })}
                    />

                    <div className="si-chips" aria-label="よく使う修正">
                      {QUICK_ACTIONS.map(([label, insert]) => (
                        <button
                          key={label}
                          type="button"
                          className="si-chip"
                          onClick={() =>
                            updateDraft({
                              instruction: `${draft.instruction.replace(/\s+$/, "")}${draft.instruction.trim() ? "\n" : ""}${insert}`,
                            })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <details className="si-details">
                      <summary>意図・補足（任意）</summary>
                      <textarea
                        className="si-textarea si-textarea--small"
                        rows={2}
                        value={draft.intent}
                        placeholder="例：ファーストビューで圧迫感を減らしたい"
                        onChange={(event) => updateDraft({ intent: event.target.value })}
                      />
                    </details>

                    <fieldset className="si-field">
                      <legend className="si-label">変更範囲</legend>
                      <div className="si-segmented">
                        {(Object.keys(SCOPE_LABELS) as Scope[]).map((scope) => (
                          <button
                            key={scope}
                            type="button"
                            aria-pressed={draft.scope === scope}
                            onClick={() => updateDraft({ scope })}
                          >
                            {SCOPE_LABELS[scope]}
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    <div className="si-grid">
                      <label className="si-field">
                        <span className="si-label">優先度</span>
                        <select
                          className="si-select"
                          value={draft.priority}
                          onChange={(event) => updateDraft({ priority: event.target.value as Priority })}
                        >
                          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((priority) => (
                            <option key={priority} value={priority}>
                              {PRIORITY_LABELS[priority]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="si-field">
                        <span className="si-label">スクリーンショット</span>
                        <label className="si-check">
                          <input
                            type="checkbox"
                            checked={draft.includeShot}
                            onChange={(event) =>
                              updateDraft({ includeShot: event.target.checked })
                            }
                          />
                          添付する
                        </label>
                      </div>
                    </div>

                    <div className="si-shot">
                      <button
                        type="button"
                        className="si-secondary"
                        disabled={!draft.includeShot || captureState === "capturing" || sendState === "sending"}
                        onClick={() => void capture()}
                      >
                        {captureState === "capturing" ? "撮影中…" : "撮影して確認"}
                      </button>
                      {captureState === "failed" && (
                        <p className="si-note si-note--error" title={captureError}>
                          取得できませんでした。ページを再読み込みした場合は、ツールバーの
                          Site Inspector アイコンを押し直してください。
                        </p>
                      )}
                      {preview && (
                        <div className="si-thumbs">
                          {preview.element && (
                            <img src={preview.element} alt="選択要素のスクリーンショット" />
                          )}
                          {preview.page && <img src={preview.page} alt="ページ全体のスクリーンショット" />}
                        </div>
                      )}
                    </div>

                    {sendState === "error" && (
                      <p className="si-banner si-banner--error" role="alert">
                        {sendError || "送信できませんでした。"}
                      </p>
                    )}

                    <button
                      type="button"
                      className="si-primary"
                      disabled={!instructionReady || sendState === "sending"}
                      onClick={() => void send()}
                    >
                      {sendState === "sending" ? "送信中…" : "この内容で送信"}
                      <span className="si-kbd">⌘/Ctrl ↵</span>
                    </button>
                    <p className="si-note">
                      送信後、AI に「Inspector の未処理依頼を修正して」と伝えてください。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="si-list-head">
                      <span className="si-label">依頼一覧</span>
                      <button type="button" className="si-mini" onClick={() => void refresh()}>
                        更新
                      </button>
                    </div>
                    {requests.length === 0 ? (
                      <p className="si-empty">
                        まだ依頼はありません。要素を選んで送信してください。
                      </p>
                    ) : (
                      <ul className="si-requests">
                        {requests.map((request) => (
                          <li key={request.id}>
                            <button
                              type="button"
                              className="si-request"
                              onClick={() => {
                                const el = resolveSelectors(request.target.selectors);
                                if (el) selectElement(el, { tab: "list" });
                                else setToast("対象の要素が見つかりませんでした");
                              }}
                            >
                              <span className="si-request-top">
                                <span className="si-request-id">#{request.id}</span>
                                <span className={`si-status si-status--${request.status}`}>
                                  <span className="si-status-dot" aria-hidden="true" />
                                  {STATUS_LABELS[request.status]}
                                </span>
                                <time dateTime={request.createdAt}>{timeLabel(request.createdAt)}</time>
                              </span>
                              <span className="si-request-text">{request.instruction}</span>
                              <span className="si-request-meta">
                                {request.target.selector}
                                {request.pageUrl !== location.href
                                  ? ` · ${new URL(request.pageUrl).pathname}`
                                  : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <footer className="si-footer">
                <span className={`si-conn si-conn--${connection}`} aria-hidden="true" />
                <span>
                  {connection === "ok" ? "127.0.0.1:3847" : "未接続 · エージェント接続で起動"}
                </span>
                <span className="si-footer-hint">Shift+Esc で終了</span>
              </footer>
            </aside>
      )}

      {!panelOpen && (
        <div className="si-pill" role="status">
          クリックで要素を選択 · Shift+Esc で終了
        </div>
      )}

      {toast && <div className="si-toast">{toast}</div>}
    </>
  );
}

function hoverStyle(rect: Rect) {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  } as const;
}
