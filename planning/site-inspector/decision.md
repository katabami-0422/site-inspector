# Site Inspector — 決定（gate 5）

日付: 2026-11-03 / 版: 0.1.0（MVP）

## 構成

```
Chrome拡張 (MV3, React, Shadow DOM)
  └─ Service Worker ── fetch(127.0.0.1:3847, Origin: chrome-extension://…)
        └─ Local Host (node:http + node:sqlite)  ← 同じDBファイル →  MCP Server (stdio)
                                                                          └─ AI coding agent
```

- データ: `%APPDATA%\site-inspector\projects\<root-hash>\inspector.db` と `shots/`（Win）。mac/linuxは各データディレクトリ。
- 1プロセス＝1プロジェクト（cwd）。MCPもcwdで同じDBを開く。
- 転送は localhost HTTP（`127.0.0.1:3847`）。Origin `chrome-extension://<32桁>` と Host を検証。
- スクショは `captureVisibleTab` → OffscreenCanvas で要素周辺を切り抜き。撮影時だけ自前UIを隠す。

## API（Local Host）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 接続確認・プロジェクト名・件数 |
| POST | `/api/requests` | 依頼作成（スクショはdata URLで受領） |
| GET | `/api/requests?status=&limit=` | 一覧 |
| GET | `/api/requests/:id` | 詳細 |
| PATCH | `/api/requests/:id` | 状態更新＋メモ |
| GET | `/api/requests/:id/screenshot?kind=page\|element` | PNG |

## 状態

`pending`（未対応）→ `in_progress`（対応中）→ `awaiting_review`（確認待ち）→ `done`（完了）／`redo`（再修正）。

## MCPツール

`list_pending_requests` / `get_request_details` / `get_screenshot` / `update_request_status` / `get_project_context` / `get_request_history`

- 一覧は軽量JSON。詳細＋スクショは画像コンテンツとして返す。
- 操作手順（対象特定→最小変更→状態更新）を各ツール説明と応答に含める。

## MVP範囲（企画書§12）

- 拡張: ON/OFF、ホバー、選択、親子移動、番号マーカー、要素情報（セレクタ候補・computed style・HTML断片・テキスト・rect・祖先）、依頼フォーム（内容/意図/範囲/優先度/スクショ有無）、複数依頼、一覧。
- ホスト: SQLite、スクショ保存、HTTP API、CLI。
- AI: MCP 6ツール、指示テンプレート。
- 対象: localhost の HTML/DOM（React/Vite/Next可）。

## 検証

1. ホスト＋MCPの統合テスト（node:test、実DB・実stdioクライアント）。
2. サンプルVite Reactサイトを headless Edge に拡張ごと読み込み、要素クリック→入力→送信→DB/画像→MCP取得→状態更新までCDPで通す。
3. 実画面スクショでUIを確認（1440）。

## 未決・次版

- ソース位置の直接特定（Viteプラグインで `data-source` 注入）。
- フルページスクショ、モバイル表示の同時取得。
- 依頼の削除・編集、複数プロジェクトのオリジン対応表。
- Native Messaging の opt-in 実装。
- アイコン・ストア配布（ライセンスは MIT で追加済み）。

## 結果（2026-11-03）

- `npm test`: 5/5 pass（実DB・実stdio MCP）。
- `npm run e2e`: PASS。拡張→ホスト→SQLite/画像→MCP の全経路を確認（詳細は `validation.md`）。
- UI: ライト / ダークを 1440×900 で確認。`design-audit` P0/P1/P2 0、`slop-scan` 0。
- 未実装として残るもの: アイコン、参考画像、モバイル幅の別撮影、IDE タスク自動開始、修正前後比較。

