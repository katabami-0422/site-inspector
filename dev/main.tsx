import type { Bridge } from "../src/extension/inspector/bridge.ts";
import { mountInspector } from "../src/extension/inspector/controller.tsx";
import type {
  CreateRequestInput,
  RequestSummary,
  RequestStatus,
} from "../src/shared/types.ts";

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

function mockImage(label: string, from: string, to: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="720" height="420" fill="url(#g)"/>
    <text x="36" y="380" fill="rgba(255,255,255,.9)" font-family="sans-serif" font-size="28">${label}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const requests: RequestSummary[] = [
  {
    id: 3,
    status: "awaiting_review",
    instruction: "見出しの文字間隔を広げて、スマートフォンでは今のサイズを維持したい。",
    pageUrl: location.href,
    createdAt: iso(12),
    updatedAt: iso(3),
    target: {
      tag: "h1",
      selector: ".hero-title",
      selectors: [".hero-title"],
      text: "現場の写真を、その日のうちに共有する",
    },
    hasScreenshot: true,
  },
  {
    id: 2,
    status: "pending",
    instruction: "カードの角丸を8pxにして、影をやめて罫線だけに。",
    pageUrl: location.href,
    createdAt: iso(38),
    updatedAt: iso(38),
    target: {
      tag: "article",
      selector: ".card",
      selectors: [".card"],
      text: "写真に注釈",
    },
    hasScreenshot: true,
  },
  {
    id: 1,
    status: "done",
    instruction: "はじめるボタンの高さを44pxにそろえる。",
    pageUrl: location.href,
    createdAt: iso(180),
    updatedAt: iso(90),
    target: {
      tag: "a",
      selector: ".cta",
      selectors: [".cta"],
      text: "はじめる",
    },
    hasScreenshot: false,
  },
];

let nextId = 4;

const offline = new URLSearchParams(location.search).has("down");

const mockBridge: Bridge = {
  async health() {
    if (offline) throw new Error("host is not running");
    return {
      ok: true,
      version: "0.1.0",
      project: {
        name: "ui-harness",
        root: "/dev/ui-harness",
        dataDir: "/dev/ui-harness/.data",
        dbPath: "/dev/ui-harness/.data/inspector.db",
        createdAt: iso(60 * 24 * 30),
      },
      counts: { pending: 1, in_progress: 0, awaiting_review: 1, done: 1, redo: 0 },
    };
  },
  async list() {
    return requests;
  },
  async create(input: CreateRequestInput) {
    const id = nextId++;
    const status: RequestStatus = "pending";
    requests.unshift({
      id,
      status,
      instruction: input.instruction,
      pageUrl: input.pageUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      target: {
        tag: input.element.target.tag,
        selector: input.element.target.selectors[0] ?? "",
        selectors: input.element.target.selectors,
        text: input.element.target.text,
      },
      hasScreenshot: Boolean(input.screenshots),
    });
    return { id, status };
  },
  async capture() {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return {
      page: mockImage("page", "#0e6b6b", "#123b4a"),
      element: mockImage("element", "#c98b3a", "#0e6b6b"),
    };
  },
};

sessionStorage.setItem("si:active", "1");
sessionStorage.setItem(
  "si:selection",
  JSON.stringify({ url: location.href, selectors: [".hero-title"] }),
);

mountInspector(mockBridge);

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") {
  document.querySelector("[data-site-inspector]")?.setAttribute("data-theme", theme);
}
