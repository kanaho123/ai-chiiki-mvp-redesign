// 接続先がデモ用 DB かどうかだけを確かめる（DB には接続しない・接続情報のパスワードは表示しない）。
// 使い方: npx tsx scripts/check-db-target.ts （デモ用 DB でなければ終了コード 1）
import { loadApprovalEnvironment } from "../server/local-env.js";
loadApprovalEnvironment();

const { demoDbProblems, describeDb } = await import("../server/db-safety.js");
console.log(`DATABASE_URL:          ${describeDb(process.env.DATABASE_URL)}`);
console.log(`DATABASE_URL_UNPOOLED: ${describeDb(process.env.DATABASE_URL_UNPOOLED)}`);
const problems = demoDbProblems();
if (problems.length > 0) {
  console.log(`NG  デモ用 DB と確認できません:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("OK  デモ用 DB（元アプリの DB ではない）");
