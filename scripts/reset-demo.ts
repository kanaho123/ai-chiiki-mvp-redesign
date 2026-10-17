// デモを初期状態に戻す。デモ用 DB（DEMO_DB_ENDPOINT と一致し、元アプリの DB でない）でのみ実行できる。
// - 新モデル: テーブルを空にして仕様書 8.1 の初期状態を入れ直す
// - ログイン失敗の記録（ロック）を消す
// - Legacy: 確認用の出品（生産者名が「確認用」で始まるもの）を削除し、旧デモ出品を入れ直す
// 使い方: npx tsx scripts/reset-demo.ts
import { loadApprovalEnvironment } from "../server/local-env.js";
loadApprovalEnvironment();

const { assertDemoDatabase, describeDb } = await import("../server/db-safety.js");
assertDemoDatabase();
console.log(`接続先: ${describeDb(process.env.DATABASE_URL)}（デモ用 DB と確認済み）`);

const { prisma } = await import("../server/db.js");
const { seedDemoData } = await import("../server/demo.js");
const { seedMvpDemo } = await import("../server/demo-mvp.js");
try {
  await seedMvpDemo(prisma);
  const test = { producer: { name: { startsWith: "確認用" } } };
  const { count } = await prisma.listing.deleteMany({ where: test });
  await prisma.legacyProducer.deleteMany({ where: { name: { startsWith: "確認用" } } });
  await seedDemoData(prisma);
  // デモ前にログインの失敗記録（ロック）も消す
  const { count: unlocked } = await prisma.authThrottle.deleteMany();
  console.log(`新モデルを初期状態に戻し、確認用の旧出品を${count}件削除しました（ログイン失敗の記録 ${unlocked}件を解除）`);
} finally {
  await prisma.$disconnect();
}
