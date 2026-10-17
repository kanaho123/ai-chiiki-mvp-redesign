// デモ用 DB のデモ供給1件の販売可能量・公開状態を変える（version を +1）。デモ台本・手動確認用。
// 使い方: npx tsx scripts/set-demo-supply.ts <a|b|c|d> <kg> [public|private]
// 元に戻すときは npx tsx scripts/reset-demo.ts
import { loadApprovalEnvironment } from "../server/local-env.js";
loadApprovalEnvironment();

const { assertDemoDatabase } = await import("../server/db-safety.js");
assertDemoDatabase();

const [key, kgArg, pub] = process.argv.slice(2);
const kg = Number(kgArg);
if (!/^[abcd]$/.test(key ?? "") || !Number.isInteger(kg) || kg < 0 || kg > 100 || (pub && !/^(public|private)$/.test(pub)))
  throw new Error("使い方: npx tsx scripts/set-demo-supply.ts <a|b|c|d> <0〜100の整数kg> [public|private]");

const { prisma } = await import("../server/db.js");
try {
  const s = await prisma.supply.update({
    where: { id: `demo-supply-${key}` },
    data: { availableKg: kg, version: { increment: 1 }, ...(pub && { published: pub === "public" }) },
    include: { producer: true },
  });
  console.log(`${s.producer.farmName}の供給を${s.availableKg}kg・${s.published ? "公開" : "非公開"}に変更（version ${s.version}）`);
} finally {
  await prisma.$disconnect();
}
