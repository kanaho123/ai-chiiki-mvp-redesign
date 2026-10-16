// 新モデルのデモデータが仕様書 8.1 の初期状態かを確かめる（読み取りのみ）。
// 使い方: npx tsx scripts/check-demo-state.ts
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../server/db.js");
let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "OK " : "NG "} ${label}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
};
const jst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

try {
  const counts = {
    users: await prisma.user.count(), producers: await prisma.producer.count(), relationships: await prisma.relationship.count(),
    items: await prisma.item.count(), varieties: await prisma.variety.count(), places: await prisma.place.count(),
    slots: await prisma.handoverSlot.count(), participants: await prisma.slotParticipant.count(), supplies: await prisma.supply.count(),
  };
  console.log("件数", counts);

  const supplies = await prisma.supply.findMany({ include: { producer: true, slot: { include: { place: true } }, variety: true, item: true }, orderBy: { id: "asc" } });
  for (const s of supplies)
    console.log(`  ${s.producer.farmName}  ${s.item.name}/${s.variety.name}  ${s.grade}  ${s.originPrefecture}  ${s.availableKg}kg  ${s.priceYenPerKg}円/kg  最低${s.minKg}kg  ${s.slot.label}(${s.slot.place.name})  ${s.published ? "公開" : "非公開"}  v${s.version}`);
  const state = supplies.map((s) => `${s.producer.farmName[0]}${s.availableKg}${s.published ? "" : "非公開"}`).join(" ");
  check("供給の初期状態", state === "A10 B5 C0非公開 D10", state);
  const price = supplies.map((s) => `${s.producer.farmName[0]}${s.priceYenPerKg}`).join(" ");
  check("税込単価", price === "A600 B550 C500 D300", price);
  check("全供給が大阪府産・同一品目・同一品種・通常規格・最低1kg",
    supplies.every((s) => s.originPrefecture === "大阪府" && s.itemId === supplies[0].itemId && s.varietyId === supplies[0].varietyId && s.grade === "regular" && s.minKg === 1));

  const rels = await prisma.relationship.findMany({ where: { priorTrade: true }, include: { producer: true, restaurant: true } });
  check("priorTrade=true は飲食店R→A農園のみ", rels.length === 1 && rels[0].producer.farmName === "A農園" && rels[0].restaurant.role === "restaurant",
    rels.map((r) => `${r.restaurant.displayName}→${r.producer.farmName}`).join(", "));

  const slots = await prisma.handoverSlot.findMany({ include: { place: true, participants: { include: { producer: true } } }, orderBy: { label: "asc" } });
  for (const s of slots)
    console.log(`  ${s.label}  ${s.place.name}  ${jst(s.startAt)}〜${jst(s.endAt).slice(11)} JST  締切${jst(s.confirmDeadlineAt)}  費用${s.feeYen}円(${s.feeConfirmed ? "確認済" : "未確認"})  最大${s.maxKg}kg  条件${s.conditionsConfirmed ? "確認済" : "未確認"}  参加:${s.participants.map((p) => p.producer.farmName).join("・")}`);
  const gp = slots.find((s) => s.label === "G-P");
  const gq = slots.find((s) => s.label === "G-Q");
  check("G-P の設定", !!gp && jst(gp.startAt) === "2026-10-23 10:00" && jst(gp.endAt) === "2026-10-23 11:00" && jst(gp.confirmDeadlineAt) === "2026-10-22 17:00"
    && gp.feeYen === 800 && gp.feeConfirmed && gp.maxKg === 20 && gp.conditionsConfirmed
    && gp.participants.map((p) => p.producer.farmName).sort().join("") === "A農園B農園C農園");
  check("G-Q は D農園のみ・G-P と別拠点", !!gq && !!gp && gq.placeId !== gp.placeId && gq.participants.map((p) => p.producer.farmName).join("") === "D農園");

  const restaurants = await prisma.user.count({ where: { role: "restaurant" } });
  const producerUsers = await prisma.user.count({ where: { role: "producer" } });
  check("デモ用ユーザー（飲食店1・生産者4）", restaurants === 1 && producerUsers === 4);
} finally {
  await prisma.$disconnect();
}
console.log(failed === 0 ? "\nすべて初期状態どおりです" : `\n${failed}件が初期状態と違います`);
process.exit(failed === 0 ? 0 : 1);
