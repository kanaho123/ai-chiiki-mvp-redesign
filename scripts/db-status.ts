// DB の出品状況を表示する確認用スクリプト（接続情報は表示しない）
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../server/db.js");
try {
  console.log(`生産者 ${await prisma.producer.count()}件／出品 ${await prisma.listing.count()}件`);
  const rows = await prisma.listing.findMany({ include: { producer: true }, orderBy: { createdAt: "asc" } });
  for (const l of rows)
    console.log(
      [l.producer.name, l.item, l.variety ?? "-", `${l.quantity}${l.unit}`, `${l.unitPrice}円/${l.unit}`, l.irregularReason ?? "通常品",
        l.availableDate, `${l.handoverStart}-${l.handoverEnd}`, l.handoverPlace, l.isPublic ? "公開中" : "停止中"].join("  "),
    );
} finally {
  await prisma.$disconnect();
}
