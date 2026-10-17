import { existsSync, readFileSync } from "node:fs";
import { config, parse } from "dotenv";
import { appMode } from "./app-mode.js";
import { assertApprovalDatabase, assertGeneralDevDatabase } from "./db-safety.js";

// ローカルでの起動・スクリプト・Prisma CLI が読む接続設定。本番の .env.local へは決して切り替えない。
// ・demo   … デモ用の開発DB（.env.approval.local）。reset-demo などデモ専用の操作はこちらだけ
// ・general … 一般ユーザー向けの開発DB（.env.general.local）。reset-demo は実行できない
// どちらを使うかは、開発サーバーなら `vite --mode general`、Prisma CLI なら環境変数 AIC_LOCAL_ENV=general で選ぶ（既定は demo）。

export type LocalEnv = "demo" | "general";

function load(file: string, assert: (env: Record<string, string | undefined>) => void, mode: LocalEnv) {
  if (process.env.VERCEL) throw new Error("開発用の操作は Vercel 上では実行できません");
  if (!existsSync(file)) throw new Error(`${file} が必要です。本番設定には切り替えません`);
  const values = parse(readFileSync(file));
  assert(values); // 読み込む前にファイル自体を確認する
  config({ path: file, override: true, quiet: true });
  process.env.APP_MODE = mode; // どのファイルを読んだかでモードを決める（ファイルの中身では変えない）
  assert(process.env); // 実際に有効になった環境も確認する
  appMode(); // モードと接続先の組み合わせ（取り違え）も確認する
}

/** デモ用の開発DB。デモ専用の操作（reset-demo・デモ seed など）はこれを使う。general の指定があれば拒否する。 */
export function loadApprovalEnvironment() {
  if (process.env.AIC_LOCAL_ENV === "general" || process.env.APP_MODE === "general") {
    throw new Error("この操作は demo 環境専用です。general mode では実行できません（reset-demo・デモ seed など）");
  }
  load(".env.approval.local", assertApprovalDatabase, "demo");
}

/** 一般ユーザー向けの開発DB。 */
export function loadGeneralEnvironment() {
  load(".env.general.local", assertGeneralDevDatabase, "general");
}

/** 開発サーバー・Prisma CLI 用：指定されたほうを読む（既定は demo）。 */
export function loadLocalEnvironment(which: LocalEnv = process.env.AIC_LOCAL_ENV === "general" ? "general" : "demo") {
  if (which === "general") loadGeneralEnvironment();
  else loadApprovalEnvironment();
}
