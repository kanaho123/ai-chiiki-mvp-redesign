// リセット処理（scripts/reset-demo.ts と同じ条件）が、確認用以外のデータを消さないことを確かめる。
// 一時的に「確認用」で始まらない出品と「確認用」の出品を作り、リセット後の残り方を見てから、一時データを ID 指定で削除する。
import { loadApprovalEnvironment } from "../server/local-env.js";
import { execFileSync } from "node:child_process";
loadApprovalEnvironment();

// 一時データを書き込むので、デモ用 DB と確認できなければ接続前に止める
const { assertDemoDatabase } = await import("../server/db-safety.js");
assertDemoDatabase();

const { prisma } = await import("../server/db.js");
const { jstDate } = await import("../src/lib/dates.js");
const base = {
  item: "トマト", quantity: 4, unit: "kg", unitPrice: 500, availableDate: jstDate(2), region: "北摂",
  handoverPlace: "安全確認用の拠点", handoverStart: "09:00", handoverEnd: "10:00", minQuantity: 1, step: 1,
};

const keep = await prisma.legacyProducer.create({ data: { name: "リセット確認・残す農家", listings: { create: base } }, include: { listings: true } });
const remove = await prisma.legacyProducer.create({ data: { name: "確認用リセット農家", listings: { create: base } }, include: { listings: true } });
const before = await prisma.listing.count();
try {
  execFileSync("npx", ["tsx", "scripts/reset-demo.ts"], { stdio: "inherit", shell: true });
  const keptListing = await prisma.listing.findUnique({ where: { id: keep.listings[0].id } });
  const removedListing = await prisma.listing.findUnique({ where: { id: remove.listings[0].id } });
  const demo = await prisma.listing.count({ where: { id: { startsWith: "demo-listing-" } } });
  console.log(`リセット前 ${before}件 → 後 ${await prisma.listing.count()}件`);
  console.log(keptListing ? "OK  確認用以外の出品は残った" : "NG  確認用以外の出品が消えた");
  console.log(removedListing ? "NG  確認用の出品が残った" : "OK  確認用の出品は削除された");
  console.log(demo === 3 ? "OK  デモの出品は3件" : `NG  デモの出品が${demo}件`);
  // 新モデル: 仕様書 8.1 の初期状態（A10 / B5 / C0非公開 / D10）に戻っていること
  const supplies = await prisma.supply.findMany({ orderBy: { id: "asc" } });
  const state = supplies.map((s) => `${s.id.replace("demo-supply-", "").toUpperCase()}${s.availableKg}${s.published ? "" : "非公開"}`).join(" ");
  console.log(state === "A10 B5 C0非公開 D10" ? `OK  新モデルの供給は初期状態（${state}）` : `NG  新モデルの供給が ${state}`);
} finally {
  await prisma.listing.deleteMany({ where: { id: { in: [keep.listings[0].id, remove.listings[0].id] } } });
  await prisma.legacyProducer.deleteMany({ where: { id: { in: [keep.id, remove.id] } } });
  console.log(`一時データを削除しました（現在 ${await prisma.listing.count()}件）`);
  await prisma.$disconnect();
}
