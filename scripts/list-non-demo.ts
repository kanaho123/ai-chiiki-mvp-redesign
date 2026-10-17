// デモ（demo-listing-*）以外の出品を一覧表示する（確認用。削除はしない）
import { loadApprovalEnvironment } from "../server/local-env.js";
loadApprovalEnvironment();
const { prisma } = await import("../server/db.js");
try {
  const rows = await prisma.listing.findMany({ where: { NOT: { id: { startsWith: "demo-listing-" } } }, include: { producer: true }, orderBy: { createdAt: "asc" } });
  console.log(`デモ以外の出品 ${rows.length}件`);
  for (const l of rows)
    console.log([l.id, l.producer.name, l.item, `${l.quantity}${l.unit}`, `${l.unitPrice}円`, l.availableDate, l.region, l.isPublic ? "公開中" : "停止中", l.createdAt.toISOString()].join("  "));
} finally {
  await prisma.$disconnect();
}
