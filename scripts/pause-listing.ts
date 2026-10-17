// 指定した ID の出品1件だけを公開停止にする（削除はしない）。
// 使い方: npx tsx scripts/pause-listing.ts <出品ID> <生産者名> <品目>
// 生産者名・品目が一致しない場合は何もしない。
import { loadApprovalEnvironment } from "../server/local-env.js";
loadApprovalEnvironment();

const [id, producerName, item] = process.argv.slice(2);
if (!id || !producerName || !item) throw new Error("使い方: npx tsx scripts/pause-listing.ts <出品ID> <生産者名> <品目>");

const { prisma } = await import("../server/db.js");
try {
  const l = await prisma.listing.findUnique({ where: { id }, include: { producer: true } });
  if (!l) throw new Error("出品が見つかりません");
  if (l.producer.name !== producerName || l.item !== item) throw new Error(`内容が一致しません（${l.producer.name}・${l.item}）`);
  const before = await prisma.listing.count({ where: { isPublic: true } });
  await prisma.listing.update({ where: { id }, data: { isPublic: false } });
  const after = await prisma.listing.count({ where: { isPublic: true } });
  console.log(`公開停止：${l.producer.name}・${l.item} ${l.quantity}${l.unit}（${id}）／公開中の出品 ${before}件 → ${after}件`);
} finally {
  await prisma.$disconnect();
}
