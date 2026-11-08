# Site Inspector — 調査（gate 1）

日付: 2026-11-03 / 対象: 企画書 §12 MVP

## 先行事例

| 製品 | 方式 | 学び |
|---|---|---|
| [React Grab](https://github.com/aidenybai/react-grab)（MIT） | npm パッケージ／ブックマークレット。`⌘/Ctrl+C` で要素選択 → クリップボードへ。コンポーネント名と**ソースファイル位置**を取得 | 精度の源泉は「DOM＋ソース位置」。クリップボード方式なので手貼り付けが残る。こちらの差別化は受信箱＋スクショ |
| [Lens](https://github.com/renderdraw/lens)（MIT） | Chrome拡張＋MCPサーバー。要素・computed styles・コンポーネントツリーを取得し、エージェントが注釈を読む | 企画にほぼ一致する先行実装。無料・OSS・複数エージェント対応は差別化にならないため、**スクショ＋依頼一覧＋状態管理**で差をつける |
| [bug-lens](https://github.com/Aoyia/bug-lens) | バグ証跡をAIへ渡す拡張 | 状態遷移（未対応→確認待ち）の需要を示す |

企画書との差分: 企画は「ソース位置の取得」を持たない。DOMのセレクタ・テキスト・HTML断片でAIが grep する前提とする（MVP）。将来は Vite プラグインで `data-source` を注入できる。

## プラットフォーム事実（確認済み）

- **スクリーンショット**: `chrome.tabs.captureVisibleTab` は `<all_urls>` か `activeTab` が必要（[Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab)）。`activeTab` はツールバーのアイコン操作で一時付与され、**タブの遷移で失効**する（HMRのフルリロード後に撮れない）。失敗時は再クリックを促す。
- **切り抜き**: MV3 Service Worker でも `OffscreenCanvas` / `createImageBitmap` が使える。SW内で `captureVisibleTab` → 画像デコード → 要素rectで切り抜き → PNG を作れる（`chrome.debugger` 不要＝警告バーなし）。
- **Local Network Access**: Chrome 142 以降、公開サイト→ローカルの fetch がゲートされる（[Chrome blog](https://developer.chrome.com/blog/local-network-access)）。拡張の Service Worker は独自のホスト権限モデルで、対象は `localhost` ページ＝ループバック同士。実機E2Eで確認する。
- **Node**: 24.20 で `.ts` をそのまま実行できる（type stripping）。`node:sqlite`（`DatabaseSync`）が使え、**WALで2プロセス同時読み書きを実測確認**（a/B 2プロセスで相互に読み書きできた）。ネイティブビルド不要。
- **MCP**: `@modelcontextprotocol/sdk` 1.32.2、zod 3.25+/4 対応。画像は `{type:"image", data, mimeType}` で返せる。
- **拡張ビルド**: CRXJS は 3.0.0（Vite 8 対応）だがメンテ要員募集中。WXT 0.21.5 は活発だがフレームワークの規約を持ち込む。素の Vite で content（IIFE）と SW の2バンドルに分ければ依存を増やさず済む。
- **配布名**: npm の `site-inspector` / `site-inspector-devtools` は空き（2026-11-03 時点）。

## 制約・リスク

1. `activeTab` 失効後のスクショ失敗 → パネルに再取得の導線を出す。
2. 拡張UIをページ内 Shadow DOM に置くため、撮影時に自前UIが写る → 撮影直前だけ `visibility:hidden`。
3. React の再描画で要素が消える → 複数セレクタ候補を保存し、一覧のマーカーは都度再解決。
4. 別オリジン iframe / Canvas / 複雑な Shadow DOM は対象外（企画書§10どおり）。
5. ローカルHTTPは任意の拡張から叩ける → `Origin: chrome-extension://<id>` と `Host: 127.0.0.1` を検証し、127.0.0.1 のみに bind。書き込みはOrigin必須。

## 参考

- [WXT vs CRXJS 2026](https://extensionbooster.net/blog/wxt-vs-crxjs-chrome-extension-framework-comparison-2026/)
- [Node.js node:sqlite](https://nodejs.org/api/sqlite.html)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
