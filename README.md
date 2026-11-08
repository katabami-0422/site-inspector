# Site Inspector

ローカルで開発中の Web サイトをクリックして、AI コーディングエージェントに修正を依頼するツールです。HTML や CSS のクラス名を調べたり、スクリーンショットをチャットに貼り付けたりする必要はありません。

- Chrome 拡張で要素を選び、修正内容を書いて送信する
- ローカルホストが依頼・DOM・CSS・スクリーンショットを SQLite に保存する
- エージェントは MCP で依頼を取得し、セレクタ・テキスト・HTML 断片・computed style・画像を見てソースを直す

外部サーバー・アカウント・AI API キーは不要です。データはすべて PC 内に保存されます。

```
Chrome (ローカルのサイト + Inspector)
        │  chrome.runtime
        ▼
Chrome 拡張の Service Worker ──HTTP (127.0.0.1:3847)──▶ ローカルホスト (SQLite + PNG)
                                                             ▲
                                                   MCP      │ stdio: npx site-inspector mcp
                                                            │ HTTP : http://127.0.0.1:3847/mcp
                                                     AI コーディングエージェント
```

## 30 秒でつなぐ

1. **拡張を入れる** — [Releases](https://github.com/katabami-0422/site-inspector/releases) の `site-inspector-extension-v*.zip` を展開し、`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」でそのフォルダを選ぶ
2. **エージェントに 1 行で登録**（例: Claude Code）

   ```bash
   claude mcp add site-inspector -- npx -y site-inspector mcp
   ```

3. **サイトを開いて要素をクリック**して依頼を送り、「Inspector の依頼を処理して」とエージェントに伝える

ホストの起動コマンドも、ポートやプロジェクトパスの設定も要りません。エージェントが MCP ツールを呼んだ瞬間に、ホストが自動でバックグラウンド起動します。

## インストール

> チェックアウトから使う場合も引数は同じです。`npm install && npm run build` のあと、`npx site-inspector` の代わりに `node src/host/cli.ts ...` を実行してください。

### 1. Chrome 拡張

公開リリースの zip を使うのが最短です。リポジトリからビルドする場合:

```bash
npm install
npm run build:ext
node src/host/cli.ts extension --open   # dist/extension を開く
```

`chrome://extensions` で「デベロッパーモード」をオンにし、「パッケージ化されていない拡張機能を読み込む」で `dist/extension` を選び、ツールバーの Site Inspector アイコンをピン留めします。

`file://` の HTML を直接開いて使う場合は、拡張の「詳細」で **「ファイルの URL へのアクセスを許可」** をオンにしてください（オフのままだとページにパネルが入りません）。

### 2. エージェント

ホストは npm パッケージに同梱されています。エージェント側は `npx -y site-inspector mcp` を 1 つ登録するだけです。

**Claude Code**

```bash
claude mcp add site-inspector -- npx -y site-inspector mcp
```

**Cursor** — `.cursor/mcp.json`（プロジェクト）または `~/.cursor/mcp.json`（全体）

```json
{
  "mcpServers": {
    "site-inspector": { "command": "npx", "args": ["-y", "site-inspector", "mcp"] }
  }
}
```

**Claude Desktop** — `claude_desktop_config.json` の `mcpServers` に同じ 1 エントリを足します。

**VS Code (Copilot)** — `.vscode/mcp.json`。キーが `servers` で、`type` が要る点だけ違います。

```json
{
  "servers": {
    "site-inspector": { "type": "stdio", "command": "npx", "args": ["-y", "site-inspector", "mcp"] }
  }
}
```

**URL しか受け付けないクライアント** — Streamable HTTP のエンドポイントを指定します。

```
http://127.0.0.1:3847/mcp
```

この場合はホストが先に動いている必要があります。プロジェクトのフォルダで次を一度実行してください（`Ctrl + C` で停止、または別ターミナルから `npx site-inspector stop`）。

```bash
npx site-inspector
```

### 設定を書き出す

上の JSON を手で書かずに済ませたい場合:

```bash
npx site-inspector init --write   # .mcp.json / .cursor/mcp.json / .vscode/mcp.json
```

既存のサーバー設定は残したまま `site-inspector` のエントリだけを足します。すでに入っている場合はそのままにし、`--force` で置き換えます。書き出さずに中身を確認したいときは `--write` を外します。

リポジトリのチェックアウトから使う場合、`init` は `node <リポジトリ>/src/host/cli.ts mcp` の絶対パスを書きます（`npx` 不要）。手で登録するなら:

```bash
node /path/to/site-inspector/src/host/cli.ts mcp
```

## プロジェクトの判定

ホストは「どのプロジェクトの DB に書くか」を次の順で決めます。設定は要りません。

1. すでに動いているホストのプロジェクト（拡張はそこに送っているので最優先）
2. `--root` / `SITE_INSPECTOR_PROJECT`（指定した場合はエージェントのルートを使わない）
3. MCP クライアントが申告するプロジェクトルート（`roots/list`。エージェントで開いているフォルダ）
4. MCP サーバーの作業ディレクトリ

別のプロジェクトに切り替えるときは、ホストを止めてから新しいフォルダで依頼してください。

```bash
npx site-inspector stop
```

## 使い方

1. サイトを `npm run dev` などで起動して `http://localhost:5173` を開く（`file:///.../index.html` を直接開いてもよい）
2. ツールバーの Site Inspector アイコンを押す（マウスオーバーで要素が枠線で強調されます）
3. 修正したい要素をクリックし、右パネルに修正内容を書く。「撮影して確認」でスクリーンショットを確認できる
4. 「この内容で送信」を押す
5. エージェントに「Inspector の未処理依頼を修正して」と一度だけ伝える
6. エージェントが MCP で依頼を取得し、コードを直し、状態を「確認待ち」にする
7. HMR で表示が更新されるので結果を確認する。気になれば同じ要素に追加依頼を出す

### ショートカット

| 操作 | キー |
|---|---|
| Inspector の ON/OFF | ツールバーのアイコン / `Shift + Esc` |
| 選択解除 | `Esc` |
| 親要素 / 子要素へ | `Alt + ↑` / `Alt + ↓`（パネルのボタンでも可） |
| 送信 | `Ctrl / ⌘ + Enter` |

## CLI

| コマンド | 用途 |
|---|---|
| `site-inspector` / `start` | ホストを前台で起動（`--root` / `--port`） |
| `mcp` | stdio の MCP サーバー。ホストが無ければ自動起動する |
| `init [--write] [--force]` | MCP 設定の表示・書き出し |
| `status` | プロジェクトと依頼件数 |
| `stop` | バックグラウンドのホストを停止 |
| `extension [--open]` | 拡張フォルダの場所を表示（`--open` で開く） |
| `doctor` | Node / ホスト / 設定 / 拡張の状態を確認 |

## 依頼の状態

`pending`（未対応）→ `in_progress`（対応中）→ `awaiting_review`（確認待ち）→ `done`（完了）。やり直しは `redo`（再修正）に戻します。ブラウザ上の同じページに、未完了の依頼が番号付きマーカーで表示されます。

## MCP ツール

| ツール | 用途 |
|---|---|
| `list_pending_requests` | 未処理（pending + redo）または指定状態の依頼一覧 |
| `get_request_details` | 依頼の全文 + 要素情報 + 画像（element crop / viewport） |
| `get_screenshot` | 画像だけを取得 |
| `update_request_status` | 状態更新（メモ付き） |
| `get_project_context` | プロジェクト情報・件数・閲覧ページ・作業手順 |
| `get_request_history` | 全状態の履歴 |

`list_pending_requests` と `get_project_context` は、AI 向けの作業手順（`src/host/instructions.ts`）も一緒に返します。

## 保存先

| OS | 場所 |
|---|---|
| Windows | `%APPDATA%\site-inspector\projects\<hash>\` |
| macOS | `~/Library/Application Support/site-inspector/projects/<hash>/` |
| Linux | `$XDG_DATA_HOME/site-inspector/projects/<hash>/`（未設定なら `~/.local/share`） |

`<hash>` はプロジェクトの絶対パスから生成されます。中身は `inspector.db`（SQLite / WAL）と `shots/`（PNG）です。消せばリセットされます。

## セキュリティとプライバシー

- 待ち受けるのは `127.0.0.1:3847` のみ。外部通信はしません
- Host ヘッダーを検証し、DNS リバインディングを拒否します
- 書き込みは `chrome-extension://<id>` の Origin を必須にしています（通常の Web ページからは書けません）
- MCP には CORS ヘッダーを付けていないため、ブラウザ上のページからは呼べません（ローカルのエージェント専用）
- 入力は zod で検証し、本文 32MB / 画像 8MB / PNG のみに制限しています
- フォームの入力値や Cookie は取得しません。要素のテキスト・HTML 断片・computed style のみです
- スクリーンショットは「撮影して確認」でプレビューでき、添付しない選択もできます
- 読み取り API は Origin なしのローカルプロセス（curl など）からも参照できます。必要な場合だけ起動してください

## 制限（MVP）

- ポートは `3847` 固定です。拡張側にポート設定 UI はありません
- **`activeTab` の寿命**: スクリーンショットはツールバーのアイコンを押した時点の権限に依存します。ページをフルリロードすると権限が切れ、撮影に失敗します（パネルに案内が出ます）。もう一度アイコンを押してください
- 対応するのは `http://localhost` / `http://127.0.0.1` / `file://` のページだけです。LAN の IP・独自ホスト名・`https` は対象外
- `file://` は拡張の詳細で「ファイルの URL へのアクセスを許可」をオンにしないと、パネルがページに入りません（アイコンに `×` が出て、ツールチップに案内が出ます）
- 撮影できるのは**表示中のタブ**だけです。ウィンドウが最小化・非アクティブだと失敗します
- スクリーンショットは現在のビューポートのみ。ページ全体の長い画像やスマートフォン幅の別撮りは未対応です
- 参考画像の添付、複数要素の同時選択、範囲ドラッグ選択は未対応
- 拡張のアイコン画像は未同梱です。ツールバーには Chrome の既定アイコンが表示されます
- Canvas / WebGL / 別オリジンの iframe / 複雑な Shadow DOM の内部は対象外
- 同時に動かせるホストは 1 つです。複数プロジェクトを並行して使うときは `site-inspector stop` で切り替えます
- ホストを自動起動できるのは stdio の MCP 経路だけです。URL だけを渡すクライアントは、先に `npx site-inspector` を起動しておく必要があります

## トラブルシューティング

- **パネルが「未接続」**: エージェントに一度ツールを呼ばせるとホストが上がります。上がらないときは `npx site-inspector doctor` で状態を確認
- **`port 3847 is already in use`**: 別のホストか別アプリが占有しています。`npx site-inspector stop` を試し、それでも駄目なら `netstat -ano | findstr :3847` で PID を確認
- **エージェントが見ているプロジェクトと DB がずれる**: 起動済みホストのプロジェクトが優先されます。`npx site-inspector stop` してから呼び直してください
- **`file://` でパネルが出ない / `×` が出る**: 拡張の詳細で「ファイルの URL へのアクセスを許可」をオンにして、ページを再読み込み

## 開発

```bash
npm test             # ホスト + MCP（stdio / HTTP）のテスト
npm run typecheck
npm run build        # CLI（dist/host）+ 拡張（dist/extension）
npm run build:ext    # 本番用（activeTab）
npm run build:ext:test # E2E 用（<all_urls>。スモークテスト専用）
npm run dev:ui       # パネル UI の確認（http://localhost:5199/dev/）
```

E2E（サンプルアプリ + ホスト + headless Edge）:

```bash
npm run build:ext:test
npm install --prefix sample-app
npm run sample                                   # 別ターミナル
(cd sample-app && node ../src/host/cli.ts start --root .)  # 別ターミナル
npm run e2e
```

`npm run e2e` は、ヘッドレス Edge に拡張を読み込ませ、要素クリック → 入力 → 送信 → SQLite と画像の保存 → MCP での取得・状態更新までを通します。スクリーンショットは `.shots/e2e-inspector.png` に保存されます。

リリースは `v0.2.0` のようなタグを push すると、`.github/workflows/release.yml` が拡張の zip を作って GitHub Release に添付します。リポジトリの Secret に `NPM_TOKEN` を入れておくと npm にも公開します。

## 企画書との差分

- **通信方式**: 企画書は Chrome Native Messaging を第一候補としていますが、インストールとデバッグの容易さを優先し、`127.0.0.1` の HTTP にしました。外部には公開せず、Host / Origin / スキーマ検証で守っています
- **拡張のビルド**: CRXJS や WXT ではなく、Vite の 2 バンドル（content / background）で十分なため、素の Vite 構成にしています
- **MVP 外**: 参考画像、モバイル幅の別撮影、IDE からの自動タスク開始、修正前後の比較は実装していません

## ライセンス

MIT
