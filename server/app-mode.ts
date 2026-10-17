// 実行環境の区別（general＝一般ユーザー向け／demo＝デモ用）。サーバー側の環境変数 APP_MODE だけで決める。
// VITE_ を付けないのでブラウザ側のコードには埋め込まれず、クライアントから変更できない。
// 環境の取り違え（一般向けにデモ用DBをつなぐ・デモ用に一般向けDBをつなぐ・一般向けで固定日時）は、
// すべての API の入口（server/http.ts の handle）で拒否する。接続情報は表示しない。
import { endpointOf } from "./db-safety.js";

export type AppMode = "general" | "demo";
type Env = Record<string, string | undefined>;

/** デモ用 DB の Neon エンドポイント（デモの本番・デモの開発）。demo mode はこのどちらかでなければ動かない。 */
export const DEMO_DB_ENDPOINTS: readonly string[] = ["ep-small-base-b7kc2j0a", "ep-sparkling-voice-b77ras92"];
/** 元アプリ ai-tiiki の DB。どちらのモードでも接続を拒否する。 */
export const ORIGINAL_DB_ENDPOINTS: readonly string[] = ["ep-hidden-union-b7n46jco"];

export class AppEnvironmentError extends Error {
  constructor(readonly problems: string[]) {
    super(`実行環境の設定に問題があるため停止しました:\n- ${problems.join("\n- ")}`);
    this.name = "AppEnvironmentError";
  }
}

/** 問題の一覧を返す（空なら正常）。 */
export function appEnvironmentProblems(env: Env = process.env): string[] {
  const mode = env.APP_MODE?.trim();
  if (mode !== "general" && mode !== "demo") return ["APP_MODE に general か demo を設定してください"];
  const problems: string[] = [];
  if (mode === "general" && env.DEMO_NOW?.trim()) problems.push("general mode では DEMO_NOW（固定日時）を設定できません");
  for (const [name, url] of [["DATABASE_URL", env.DATABASE_URL], ["DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED]] as const) {
    if (!url) continue; // DB を使わない処理（テストなど）は接続先の確認を省く
    const ep = endpointOf(url);
    if (!ep) problems.push(`${name} の接続先を確認できません`);
    else if (ORIGINAL_DB_ENDPOINTS.includes(ep)) problems.push(`${name} が元アプリの DB です`);
    else if (mode === "general" && DEMO_DB_ENDPOINTS.includes(ep)) problems.push(`general mode で ${name} がデモ用 DB です`);
    else if (mode === "demo" && !DEMO_DB_ENDPOINTS.includes(ep)) problems.push(`demo mode で ${name} がデモ用 DB ではありません`);
  }
  return problems;
}

/** 正しい実行環境ならモードを返し、問題があれば例外を投げる。 */
export function appMode(env: Env = process.env): AppMode {
  const problems = appEnvironmentProblems(env);
  if (problems.length > 0) throw new AppEnvironmentError(problems);
  return env.APP_MODE!.trim() as AppMode;
}

export const isDemoMode = (env: Env = process.env) => appMode(env) === "demo";
