export const WORKFLOW = `# Site Inspector 修正依頼

Site Inspector から届いた修正依頼を処理してください。

1. 対象プロジェクトと現在のファイル構造を確認する。
2. get_request_details で対象要素のセレクタ・テキスト・HTML断片・computed style を読む。
3. スクリーンショットと現在のCSSを参考にする。
4. ユーザーの scope（element / component / page）を守る。
5. 必要最小限のコード変更を行う。
6. 他のコンポーネントへの影響を確認する。
7. 修正後、update_request_status で awaiting_review（確認待ち）にする。

対象が特定できない場合は推測で変更しない。
依頼にない大規模なリファクタリングを行わない。
複数の依頼は1件ずつ処理し、それぞれの状態を更新する。`;
