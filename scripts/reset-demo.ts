// デモを初期状態に戻す：確認用の出品（生産者名が「確認用」で始まるもの）を削除し、
// A農家5kg・B農家3kg・C農家2kg のデモデータを入れ直す。使い方: npx tsx scripts/reset-demo.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../server/db.js");
const { seedDemoData } = await import("../server/demo.js");
try {
  const test = { producer: { name: { startsWith: "確認用" } } };
  const { count } = await prisma.listing.deleteMany({ where: test });
  await prisma.producer.deleteMany({ where: { name: { startsWith: "確認用" } } });
  await seedDemoData(prisma);
  console.log(`確認用の出品を${count}件削除し、デモデータを初期状態に戻しました`);
} finally {
  await prisma.$disconnect();
}
