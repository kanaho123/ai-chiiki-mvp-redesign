# 退避：Next.js 版の実装（2026-10-14）

ブートキャンプの指定構成（Vite／Vercel Functions／Postgres／Prisma）へ切り替えるため、
Next.js で途中まで実装したファイルをここへ退避した。ファイルはプロジェクト直下と同じ相対パスで置いている。
`MANIFEST.sha256` は退避元ファイルのハッシュで、`sha256sum -c MANIFEST.sha256` で一致を確認できる。

## 内容

| パス | 内容 | 再利用 |
| --- | --- | --- |
| `src/lib/allocate.ts` | 配分ロジック（複数農家の出品 → 1店舗の仕入れ案）。フレームワーク非依存 | **そのまま再利用可** |
| `src/lib/allocate.test.ts` | 配分ロジックのテスト 16件（退避前に全件成功を確認） | **そのまま再利用可**（vitest） |
| `src/lib/dates.ts` / `constants.ts` | 日本時間の日付処理、地域・単位などの定数 | 再利用可 |
| `src/lib/validate.ts` | API 入力のサーバー側検証 | Vercel Functions で再利用可 |
| `src/lib/db.ts` / `demo.ts`, `prisma/` | Prisma スキーマ（Producer・Listing）、デモデータ投入 | 再利用可（Prisma 6 前提） |
| `src/app/api/**` | Next.js Route Handlers（仕入れ案・出品・在庫バージョン・デモ初期化） | 処理は流用可、形式は Vercel Functions 用に書き換えが必要 |
| `src/app/**/page.tsx`, `layout.tsx`, `globals.css` | Next.js の画面（トップ・飲食店） | React 部分は流用可。`next/link` などは置き換えが必要 |
| `package.json` / `package-lock.json` / `tsconfig.json` / `next.config.ts` / `vitest.config.mts` | Next.js 版の依存と設定 | 参照用 |

生産者画面（出品登録・数量変更・公開停止）は未作成。DB に接続した動作確認は未実施（Docker が起動できなかったため）。

## 配分ロジックが対応している仕様（`01_spec.md` 旧仕様）

- 同一品目・同一単位の出品だけを組み合わせる（個と kg は換算しない）
- 希望日は期限。地域は完全一致。規格外不可なら規格外の出品を除外
- 税込単価の上限（円/単位）、受渡場所・時間の指定を照合
- 受渡日・場所・時間が同じ出品どうしだけを組み合わせる
- 在庫上限・最低販売量・販売刻みを守る（刻みが違うだけでは除外しない）
- 成立案が複数あれば「仕入れ先が少ない」→「合計価格が低い」の順
- 不足時は丸めずに「希望10kgに対し…8kg。2kg不足」と表示

## 復元方法

プロジェクト直下で（Git 管理後なら `git` の履歴からも戻せる）:

```bash
cp -r archive/2026-10-14-nextjs/{src,prisma,package.json,package-lock.json,tsconfig.json,next.config.ts,vitest.config.mts} .
npm ci
```
