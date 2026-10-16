# 未完了事項（TODO）

## 実 Gemini API の接続確認（未検証）

- 状態：AI 抽出機能（`api/extract.ts`・`server/ai/gemini.ts`・`src/lib/resolve.ts`）は実装済み。単体テストは Gemini をモックして実施済み。**実 API には一度も接続していない（実 API 確認済みではない）。**
- 理由：Gemini API キーが未作成のため。`GEMINI_API_KEY` / `GEMINI_MODEL` は意図的に未設定（ダミー値・モデル名も設定しない）。
- 未設定の間の動作：AI は「使えない」と表示し、入力文を残したまま手入力で同じ `/api/plan` に進む。AI が使えないことを候補0件として扱わない。5分デモは手入力だけで成立させる。
- 確認手順（キーを用意できたら Phase 5 の最後に実施）：
  1. `.env.local`（ローカル）と Vercel の環境変数に `GEMINI_API_KEY` と `GEMINI_MODEL` を設定する（値はチャット・ログに出さない）
  2. デモ文「10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK」で1回だけ抽出する
  3. 確認画面の初期値が「トマト・10kg・2026-10-23・8,000円（受渡費込み）・大阪府産・A農園優先・初回を含める」になり、受渡枠・規格外・混在が「要確認」で残ることを確認する
  4. 応答時間が10秒以内であること、失敗時に手入力へ切り替えられることを確認する

## 本番環境（2026-10-16 デプロイ）

- 本番 URL：https://ai-chiiki-mvp-redesign.vercel.app（Vercel プロジェクト `ai-chiiki-mvp-redesign`。元の `ai-tiiki` とは別）
- Production の環境変数：`DATABASE_URL`・`DATABASE_URL_UNPOOLED`（Neon branch `mvp-redesign`）・`SESSION_SECRET`（本番用）・`DEMO_NOW`。`GEMINI_*` は未設定
- 本番での受入確認：デモフロー（A10 6,800円 → A5＋B5 6,550円 → 9kg・1kg不足 6,000円）・権限拒否・セキュリティヘッダー・375px 表示・AI 未設定時の手入力切替を確認済み
- 本番と開発（ローカル）は同じデモ用 DB を使う。本番で数量を変えるとローカルにも反映される。デモ後は `npx tsx scripts/reset-demo.ts`
- 軽微：`/favicon.ico` が 404（表示には影響なし。次回デプロイ時にアイコンを追加する）

## その他（MVP として割り切った点）

- ログアウト後も、削除前にコピーされたセッション Cookie は有効期限（8時間）まで使える（サーバー側でのセッション無効化は無い）
- ログイン試行・AI 呼び出しの回数制限はサーバーのインスタンスごとの簡易的なもの
- 旧 Listing のテーブル（`Producer` / `Listing`）は DB に残っている（画面・API からは使わない）
