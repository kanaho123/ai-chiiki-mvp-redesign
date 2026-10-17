# 未完了事項（TODO）

## デモデイ用完成版として凍結（2026-10-17）

- 凍結したコミット：`9ee4584`（git タグ `demo-day-freeze`）。本番 https://ai-chiiki-mvp-redesign.vercel.app はこの版
- 以降は新機能の追加・UI 変更・リファクタリングをしない（デモ当日の不具合対応が必要な場合も、まず原因と影響を確認してから判断する）
- 本番での最終確認（2026-10-17）：実 OpenAI 読み取り（約3.9秒）→ 確認 → A10kg・6,800円 → A農園 10→5kg → 旧案の無効表示 → A5＋B5・6,550円 → B農園 5→4kg → 9kgまで・あと1kg不足・6,000円（条件を満たさない）。375／390／430px・1366×768 で横はみ出し0・48px未満の操作部品0。生産者の更新直後の表示、「待たずに手入力する」後に AI 結果で上書きされないことも確認済み
- デモ前・デモ後は `npx tsx scripts/reset-demo.ts` → `npx tsx scripts/check-demo-state.ts`（手順は docs/DEMO.md）

## 実 OpenAI API の接続確認

- ローカル：**確認済み（2026-10-16）**。`OPENAI_MODEL=gpt-6-luna`、Responses API で1回だけ抽出（応答 約6.9秒、10秒タイムアウト以内）
  - デモ文「10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK」から、トマト・10kg・「10月23日金曜」・8,000円（受渡費込み）・「大阪産」・A農園・初回OK を抽出。規格外・品種混在・規格混在は null（補完なし）
  - 確認画面の初期値は 2026-10-23・大阪府・A農園優先。要確認は受渡枠・規格外・品種混在・規格混在の4項目
  - 未確定項目を選んで /api/plan → A農園10kg・6,000円＋800円＝総額6,800円（MATCHED）
- 本番：**確認済み（2026-10-16）**。Vercel Production に `OPENAI_API_KEY`・`OPENAI_MODEL` を設定して再デプロイ。本番 URL から1回だけ抽出（画面上 約5.1秒）→ 確認画面 → G-P を選択 → A5＋B5・総額6,550円（A10→5 の後）
- 注意：応答時間が約7秒と 10 秒の上限に近い。タイムアウトした場合も入力文を残して手入力へ切り替えられる
- 実装：`api/extract.ts`・`server/ai/openai.ts`・`src/lib/resolve.ts`。Gemini 実装は削除済み

## 本番環境（2026-10-16 デプロイ、Phase 5 で再デプロイ）

- 本番 URL：https://ai-chiiki-mvp-redesign.vercel.app（Vercel プロジェクト `ai-chiiki-mvp-redesign`。元の `ai-tiiki` とは別）
- Production の環境変数：`DATABASE_URL`・`DATABASE_URL_UNPOOLED`（Neon branch `mvp-redesign`）・`SESSION_SECRET`（本番用）・`DEMO_NOW`・`OPENAI_API_KEY`・`OPENAI_MODEL`。`DEMO_LOGIN_PASSWORD`・`DEMO_DB_ENDPOINT` は CLI（seed・reset-demo）専用なので本番には置かない
- 本番での受入確認：デモフロー（A10 6,800円 → A5＋B5 6,550円 → 9kg・1kg不足 6,000円）・権限拒否・セキュリティヘッダー・375px 表示・AI 未設定時の手入力切替を確認済み
- 本番と開発（ローカル）は同じデモ用 DB を使う。本番で数量を変えるとローカルにも反映される。デモ後は `npx tsx scripts/reset-demo.ts`
- ログイン失敗の記録は DB（`auth_throttles`）。ログイン名＋接続元で5回・接続元で30回失敗すると15分ロック。`reset-demo` で解除される

## 残るリスク（デモ前に知っておくこと）

- Vercel のビルドログに TypeScript の型エラー（警告）が出る：ルートの `tsconfig.json` に compilerOptions が無く、Vercel の関数ビルダーが strict ではない設定で型チェックするため。ビルドは成功し、本番の動作確認でも影響なし（手元の `tsc -b` は strict でエラーなし）。直す場合はルート tsconfig に strict 設定を足す小さな変更
- Neon（無料枠）の DB は使われないと停止するため、久しぶりの最初の接続が遅い・一度だけ失敗することがある（Phase 5 の確認中に CLI で1回発生、再実行で正常）。デモ直前に `reset-demo` と `check-demo-state` を実行して DB を起こしておく
- OpenAI の応答はローカル約6.9秒・本番約5.1秒で、10秒の上限に余裕は大きくない。超えた場合も入力文を残して手入力へ切り替えられる
- 本番とローカルは同じデモ用 DB。本番デモ中にローカルで reset-demo しない

## その他（MVP として割り切った点）

- ログアウト後も、削除前にコピーされたセッション Cookie は有効期限（8時間）まで使える（サーバー側でのセッション無効化は無い）
- ログイン試行・AI 呼び出しの回数制限はサーバーのインスタンスごとの簡易的なもの
- 旧 Listing のテーブル（`Producer` / `Listing`）は DB に残っている（画面・API からは使わない）
