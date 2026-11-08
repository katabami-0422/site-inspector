# Site Inspector — 検証（MVP）

日付: 2026-11-03

## 1. ホスト + MCP（自動テスト）

```bash
npm test
```

5/5 pass。

- 読み取りは Origin なしで可、書き込みは Chrome 拡張 Origin 必須
- 依頼作成 → SQLite 保存 → 一覧 → 詳細 → PNG 配信
- PATCH で状態更新
- stdio MCP クライアントから `list_pending_requests` / `get_request_details`（画像2枚）/ `update_request_status`

## 2. 拡張の E2E（headless Edge + CDP）

前提: `npm run build:ext:test`、`sample-app` を 5173 で起動、ホストを `--root sample-app` で起動。

```bash
npm run e2e
```

結果: **PASS**（最終実行は依頼 #8。初回は #7）

- ヘッドレス Edge に拡張を読み込み、Service Worker を CDP で特定
- コンテンツスクリプトの Shadow host を確認
- `chrome.tabs.sendMessage` で Inspector を ON
- `.hero-title` を実マウスイベントでクリック
- テキスト入力 → 送信
- Host API で依頼を確認（セレクタ 3 件、指示文一致）
- スクリーンショット 2 枚（ページ / 要素切り抜き）が `shots/` に保存されている
- MCP 6 ツールを列挙し、一覧・詳細（画像 2 枚）・状態更新を確認

証跡: `.shots/e2e-inspector.png`、`%APPDATA%\site-inspector\projects\<hash>\shots\*.png`

## 3. UI

`npm run dev:ui` → `http://localhost:5199/dev/` を 1440×900 で撮影し、ライト / ダークを確認。

- パネル 360px、本文 14px、注記 12px、本文の行間 1.6
- 選択リングとタグは Accent 1 色。状態色は Semantic のみ
- `design-audit`: P0 0 / P1 0 / P2 0
- `slop-scan`: 0 件
- 主要ペアのコントラスト実測: 6.0〜14.0:1（light / dark とも本文・UI 4.5:1 以上）

## 4. file:// の素のHTML（拡張の E2E 追加）

`.shots/file-probe.mjs`（一時スクリプト）で、サーバーなしの HTML を `file:///` で開いて確認。

- コンテンツスクリプトが注入され、Shadow host がマウントされる
- ツールバー相当の toggle でパネルが開き、`.hero-title` のクリックで選択される
- 送信すると `pageUrl` が `file:///C:/.../plain.html` で保存され、画像2枚も `shots/` に保存される
- 実ブラウザでは「ファイルの URL へのアクセスを許可」が必要（アイコン `×` のツールチップに案内）
- 本番 manifest（`activeTab`）での撮影は、ヘッドレスではツールバー操作を再現できず未検証。テストは `<all_urls>` ビルドで実施

## 5. 確認済みの制限

- フルリロード後は `activeTab` が切れ、スクリーンショットが失敗する（パネルに案内）
- 非アクティブ / 最小化ウィンドウでは撮影できない
- 本番 manifest（activeTab）での撮影は、ヘッドレスではツールバー操作を再現できないため未検証。E2E は `<all_urls>` のテストビルドで実施
- 本番ビルド `dist/extension/manifest.json` は `activeTab` と localhost の host_permissions のみで、`<all_urls>` を含まないことを確認済み
- 参考画像・モバイル幅撮影・修正前後比較は未実装
