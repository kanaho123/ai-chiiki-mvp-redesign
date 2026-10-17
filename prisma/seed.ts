import { loadApprovalEnvironment } from "../server/local-env.js";
loadApprovalEnvironment();

// デモ用 DB と確認できなければ、DB に接続する前に止める
const { assertDemoDatabase } = await import("../server/db-safety.js");
assertDemoDatabase();

const { prisma } = await import("../server/db.js");
const { seedDemoData } = await import("../server/demo.js");
const { seedMvpDemo } = await import("../server/demo-mvp.js");

try {
  await seedMvpDemo(prisma);
  console.log("新モデルのデモデータを投入しました（A10kg・B5kg・C0kg非公開・D10kg、G-P／G-Q）");
  // Legacy: 現行画面用の旧出品データ（Phase 2 で削除予定）
  const { availableDate } = await seedDemoData(prisma);
  console.log(`旧出品データも投入しました（受渡日 ${availableDate}）`);
} finally {
  await prisma.$disconnect();
}
