# 未完了事項（TODO）

## 実 OpenAI API の接続確認

- ローカル：**確認済み（2026-10-16）**。`OPENAI_MODEL=gpt-6-luna`、Responses API で1回だけ抽出（応答 約6.9秒、10秒タイムアウト以内）
  - デモ文「10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK」から、トマト・10kg・「10月23日金曜」・8,000円（受渡費込み）・「大阪産」・A農園・初回OK を抽出。規格外・品種混在・規格混在は null（補完なし）
  - 確認画面の初期値は 2026-10-23・大阪府・A農園優先。要確認は受渡枠・規格外・品種混在・規格混在の4項目
  - 未確定項目を選んで /api/plan → A農園10kg・6,000円＋800円＝総額6,800円（MATCHED）
- 本番：**未設定**。Vercel の Production 環境変数に `OPENAI_API_KEY`・`OPENAI_MODEL` を設定し、再デプロイするまで本番は手入力のみ（AI 未設定時の手入力切替は本番で確認済み）
- 注意：応答時間が約7秒と 10 秒の上限に近い。タイムアウトした場合も入力文を残して手入力へ切り替えられる
- 実装：`api/extract.ts`・`server/ai/openai.ts`・`src/lib/resolve.ts`。Gemini 実装は削除済み

## 本番環境（2026-10-16 デプロイ）

- 本番 URL：https://ai-chiiki-mvp-redesign.vercel.app（Vercel プロジェクト `ai-chiiki-mvp-redesign`。元の `ai-tiiki` とは別）
- Production の環境変数：`DATABASE_URL`・`DATABASE_URL_UNPOOLED`（Neon branch `mvp-redesign`）・`SESSION_SECRET`（本番用）・`DEMO_NOW`。`OPENAI_*` は未設定（本番に反映するには環境変数の設定と再デプロイが必要）
- 本番での受入確認：デモフロー（A10 6,800円 → A5＋B5 6,550円 → 9kg・1kg不足 6,000円）・権限拒否・セキュリティヘッダー・375px 表示・AI 未設定時の手入力切替を確認済み
- 本番と開発（ローカル）は同じデモ用 DB を使う。本番で数量を変えるとローカルにも反映される。デモ後は `npx tsx scripts/reset-demo.ts`
- 軽微：`/favicon.ico` が 404（表示には影響なし。次回デプロイ時にアイコンを追加する）

## その他（MVP として割り切った点）

- ログアウト後も、削除前にコピーされたセッション Cookie は有効期限（8時間）まで使える（サーバー側でのセッション無効化は無い）
- ログイン試行・AI 呼び出しの回数制限はサーバーのインスタンスごとの簡易的なもの
- 旧 Listing のテーブル（`Producer` / `Listing`）は DB に残っている（画面・API からは使わない）
