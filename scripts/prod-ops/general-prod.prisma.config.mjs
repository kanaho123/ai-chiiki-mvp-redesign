// 一般向け Production DB（Neon ai-chiiki-general main）専用の Prisma 設定（運用用。アプリの本体からは使わない）。
// 使い方（リポジトリ直下で）：npx prisma migrate status --config scripts/prod-ops/general-prod.prisma.config.mjs
//                       　npx prisma migrate deploy --config scripts/prod-ops/general-prod.prisma.config.mjs（承認を得てから）
// 接続情報は .env.general.production.local（Git 対象外）からだけ読む。ここには書かない。
// .env.general.production.local だけを読み、許可した1つのエンドポイント以外では起動しない（値は表示しない）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ALLOWED = "ep-bitter-credit-b8fbhoir";
const BLOCKED = ["ep-small-base-b7kc2j0a", "ep-sparkling-voice-b77ras92", "ep-hidden-union-b7n46jco", "ep-polished-surf-b82ja29g"];
const env = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.general.production.local"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ep = (u) => { try { return new URL(u).hostname.split(".")[0].replace(/-pooler$/, ""); } catch { return null; } };
const pooled = ep(env.DATABASE_URL), direct = ep(env.DATABASE_URL_UNPOOLED);
const problems = [];
if (process.env.VERCEL || process.env.VERCEL_ENV) problems.push("Vercel 上では実行しない");
if (env.GENERAL_PROD_DB_ENDPOINT !== ALLOWED) problems.push("GENERAL_PROD_DB_ENDPOINT が許可したエンドポイントではない");
if (pooled !== ALLOWED || direct !== ALLOWED) problems.push("接続先が許可したエンドポイントではない");
if ([pooled, direct].some((x) => BLOCKED.includes(x))) problems.push("ほかの環境の DB");
if (!env.DATABASE_URL?.includes("-pooler.") || env.DATABASE_URL_UNPOOLED?.includes("-pooler.")) problems.push("pooled / direct の取り違え");
if (problems.length) throw new Error("一般向け Production DB と確認できないため中止：" + problems.join(" / "));
process.env.DATABASE_URL = env.DATABASE_URL;
process.env.DATABASE_URL_UNPOOLED = env.DATABASE_URL_UNPOOLED;
delete process.env.DEMO_NOW;
console.error(`[general-prod.config] 接続先 ${ALLOWED}（一般向け Production DB）`);

export default {
  schema: resolve(process.cwd(), "prisma/schema.prisma"),
  migrations: { path: resolve(process.cwd(), "prisma/migrations") },
};
