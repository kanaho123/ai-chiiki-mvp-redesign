// デモデータの投入・リセット前に、接続先が「デモ用に切り離した DB」であることを確かめる。
// 元アプリ ai-tiiki の DB（Neon main）には絶対に書き込まない。接続情報は表示しない。

// 元アプリの Neon エンドポイント。ここに接続している間は seed / reset を拒否する。
export const PROTECTED_DB_ENDPOINTS: readonly string[] = ["ep-hidden-union-b7n46jco", "ep-small-base-b7kc2j0a"];
export const APPROVAL_DB_ENDPOINT = "ep-sparkling-voice-b77ras92";

/** 接続文字列から Neon のエンドポイント ID（-pooler を除く）を取り出す。読めなければ null。 */
export function endpointOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const parsed = new URL(url);
    if (!/^postgres(ql)?:$/.test(parsed.protocol) || !/^ep-[a-z0-9-]+(?:-pooler)?\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech$/.test(host)) return null;
    return host.split(".")[0].replace(/-pooler$/, "") || null;
  } catch {
    return null;
  }
}

/** パスワードを除いた、表示してよい接続先の説明（例: ep-xxx / neondb） */
export function describeDb(url: string | undefined): string {
  if (!url) return "（未設定）";
  try {
    const u = new URL(url);
    return `${u.hostname.split(".")[0]} / ${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "（読めない接続文字列）";
  }
}

type Env = Record<string, string | undefined>;

/** 問題があれば理由の一覧を返す。空なら安全。 */
export function demoDbProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  const pooled = endpointOf(env.DATABASE_URL);
  const direct = endpointOf(env.DATABASE_URL_UNPOOLED);
  const allowed = env.DEMO_DB_ENDPOINT?.trim();

  if (env.VERCEL_ENV === "production") problems.push("Vercel の本番環境では実行できません");
  if (!pooled) problems.push("DATABASE_URL が未設定か読めません");
  if (!direct) problems.push("DATABASE_URL_UNPOOLED が未設定か読めません");
  if (pooled && direct && pooled !== direct) problems.push("DATABASE_URL と DATABASE_URL_UNPOOLED の接続先が違います");
  for (const ep of [pooled, direct])
    if (ep && PROTECTED_DB_ENDPOINTS.includes(ep)) problems.push(`元アプリの DB（${ep}）に接続しています`);
  if (!allowed) problems.push("DEMO_DB_ENDPOINT が未設定です（デモ用 DB のエンドポイント ID を .env.local に設定）");
  else if (PROTECTED_DB_ENDPOINTS.includes(allowed)) problems.push("DEMO_DB_ENDPOINT に元アプリの DB が指定されています");
  else if (pooled && pooled !== allowed) problems.push(`接続先（${pooled}）が DEMO_DB_ENDPOINT と一致しません`);
  return problems;
}

/** デモ用 DB でなければ例外を投げて止める。 */
export function assertDemoDatabase(env: Env = process.env): void {
  const problems = demoDbProblems(env);
  if (problems.length > 0) throw new Error(`デモ用 DB と確認できないため中止しました:\n- ${problems.join("\n- ")}`);
}

/**
 * 一般ユーザー向けの開発DBであることを確かめる（.env.general.local の GENERAL_DB_ENDPOINT と完全一致）。
 * デモ用DB・元アプリのDB・Vercel 上・固定日時（DEMO_NOW）の設定は拒否する。
 */
export function assertGeneralDevDatabase(env: Env = process.env): void {
  const problems: string[] = [];
  const pooled = endpointOf(env.DATABASE_URL);
  const direct = endpointOf(env.DATABASE_URL_UNPOOLED);
  const allowed = env.GENERAL_DB_ENDPOINT?.trim();
  const blocked = [...PROTECTED_DB_ENDPOINTS, APPROVAL_DB_ENDPOINT];
  if (env.VERCEL || env.VERCEL_ENV) problems.push("Vercel 上では実行できません");
  if (!pooled || !direct) problems.push("DATABASE_URL / DATABASE_URL_UNPOOLED が未設定か読めません");
  if (!allowed) problems.push("GENERAL_DB_ENDPOINT が未設定です");
  else if (blocked.includes(allowed)) problems.push("GENERAL_DB_ENDPOINT にデモ用または元アプリの DB が指定されています");
  for (const ep of [pooled, direct]) if (ep && blocked.includes(ep)) problems.push(`デモ用または元アプリの DB（${ep}）に接続しています`);
  if (allowed && (pooled !== allowed || direct !== allowed)) problems.push("接続先が GENERAL_DB_ENDPOINT と一致しません");
  if (env.DATABASE_URL && !env.DATABASE_URL.includes("-pooler.")) problems.push("DATABASE_URL はプール接続（-pooler）にしてください");
  if (env.DATABASE_URL_UNPOOLED?.includes("-pooler.")) problems.push("DATABASE_URL_UNPOOLED は直接接続にしてください");
  if (env.DEMO_NOW?.trim()) problems.push("一般ユーザー向けの環境に DEMO_NOW（固定日時）は設定できません");
  if (problems.length > 0) throw new Error(`一般ユーザー向けの開発DBと確認できないため中止しました:\n- ${problems.join("\n- ")}`);
}

/** This feature branch permits destructive DB operations only on approval-dev. */
export function assertApprovalDatabase(env: Env = process.env): void {
  assertDemoDatabase(env);
  if ([endpointOf(env.DATABASE_URL), endpointOf(env.DATABASE_URL_UNPOOLED), env.DEMO_DB_ENDPOINT?.trim()].some((ep) => ep !== APPROVAL_DB_ENDPOINT)) {
    throw new Error("approval-dev 以外への DB 変更を拒否しました");
  }
  const pooled = new URL(env.DATABASE_URL!);
  const direct = new URL(env.DATABASE_URL_UNPOOLED!);
  if (pooled.pathname !== "/neondb" || direct.pathname !== "/neondb" || pooled.username !== direct.username || pooled.password !== direct.password || !pooled.hostname.includes("-pooler.") || direct.hostname.includes("-pooler.")) {
    throw new Error("開発用 DB のデータベース名・ユーザー・pooled/direct 設定が一致しません");
  }
}
