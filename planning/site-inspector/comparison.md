# Site Inspector — 比較（gate 2）

## 1. 転送方式: Chrome拡張 ⇄ Local Host

| 観点 | Native Messaging | localhost HTTP（127.0.0.1固定ポート） |
|---|---|---|
| セットアップ | OSごとにホスト登録（Windowsはレジストリ、macは `~/Library/...`）。拡張IDを `allowed_origins` に固定（manifest `key` が必要） | `npx site-inspector start` だけ。拡張は固定URLを見る |
| 攻撃面 | ポートを開かない。呼べるのは登録済み拡張のみ | ローカルポートが開く。任意のページ/拡張から到達しうる → Origin・Host検証で拒否 |
| デバッグ | stdioの4バイト長フレーム。不具合時に見えにくい | curl で叩ける。ブラウザDevToolsで見える |
| 復帰 | ホストプロセスは接続ごとに起動・終了 | 常駐。落ちても再起動のみ |
| 拡張性 | Chrome専用の密結合 | 将来のWeb UI・他ブラウザ・CLIからも同じAPI |
| 企画書との関係 | §5で「第一候補」 | 変更提案 |

**判断: localhost HTTP。** 理由は導入障壁（レジストリ登録なし）とデバッグ性。セキュリティは「127.0.0.1 bind＋Host検証＋`chrome-extension://` Origin必須＋スキーマ検証」で担保する。Native Messaging は将来の opt-in transport として残す。

## 2. 拡張のビルド

| 方式 | 長所 | 短所 |
|---|---|---|
| CRXJS 3 | HMR、manifest変換 | メンテ体制が不透明。Vite大型アップデート追随リスク |
| WXT | 活発、MV3/CSP/自動import | 規約と抽象化が増える。学習コスト |
| **素のVite 2バンドル** | 依存最小、content=IIFE/SW=IIFEで確実 | 拡張のHMRなし（`--watch`＋手動リロード） |

**判断: 素のVite。** UI反復は `dev.html` のハーネス（通常のVite HMR）で行い、結合時だけ拡張を再読み込みする。

## 3. 保存

| 方式 | 長所 | 短所 |
|---|---|---|
| better-sqlite3 13 | 実績、同期API | ネイティブビルド（配布時にNode ABI問題） |
| **node:sqlite** | 追加依存ゼロ、WALの2プロセス同時利用を実測 | Node 22.5+ 必須。APIはやや少ない |

**判断: node:sqlite。** `engines: node >= 22.18`（TS直接実行のため）。

## 4. スクリーンショット

| 方式 | 判定 |
|---|---|
| **captureVisibleTab + OffscreenCanvas** | 採用。権限警告なし、要素切り抜き可 |
| chrome.debugger | 不採用。強力だが「デバッグ中」バーが出る |
| html2canvas等 | 不採用。再現精度が低く、依存が重い |

## 5. プロジェクトの紐付け

- Local Host は**起動時のカレントディレクトリ**をプロジェクト根とする（`--root` で上書き可）。
- MCP も**起動時の cwd**（または `SITE_INSPECTOR_PROJECT`）で同じDBを開く。
- マルチプロジェクトは「オリジン→根」の対応表を後から追加（MVP対象外）。
