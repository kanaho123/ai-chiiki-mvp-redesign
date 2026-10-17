import { existsSync } from "node:fs";
import { config, parse } from "dotenv";
import { readFileSync } from "node:fs";
import { assertApprovalDatabase } from "./db-safety.js";

/** Local approval work must never silently fall back to the Production .env.local. */
export function loadApprovalEnvironment() {
  if (process.env.VERCEL) throw new Error("開発用の操作は Vercel 上では実行できません");
  if (!existsSync(".env.approval.local")) throw new Error(".env.approval.local が必要です。本番設定には切り替えません");
  const values = parse(readFileSync(".env.approval.local"));
  // Validate the file itself before loading, then also validate the effective environment.
  assertApprovalDatabase(values);
  config({ path: ".env.approval.local", override: true, quiet: true });
  assertApprovalDatabase();
}
