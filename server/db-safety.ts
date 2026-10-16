// デモデータの投入・リセット前に、接続先が「デモ用に切り離した DB」であることを確かめる。
// 元アプリ ai-tiiki の DB（Neon main）には絶対に書き込まない。接続情報は表示しない。

// 元アプリの Neon エンドポイント。ここに接続している間は seed / reset を拒否する。
export const PROTECTED_DB_ENDPOINTS: readonly string[] = ["ep-hidden-union-b7n46jco"];

/** 接続文字列から Neon のエンドポイント ID（-pooler を除く）を取り出す。読めなければ null。 */
export function endpointOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
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
