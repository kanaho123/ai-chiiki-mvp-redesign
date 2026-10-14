import type { PrismaClient } from "./generated/prisma/client.js";
import { DEMO_PLACE } from "../src/lib/constants.js";
import { jstDate } from "../src/lib/dates.js";

// 仕様書8章のデモデータ（架空）。受渡は日本時間の「明後日」10〜11時、拠点P。
// 固定 ID で upsert するので、何度投入しても重複せず、初期値に戻る。
const DEMO = [
  { key: "a", name: "A農家", quantity: 5, unitPrice: 600, irregularReason: null },
  { key: "b", name: "B農家", quantity: 3, unitPrice: 550, irregularReason: null },
  { key: "c", name: "C農家", quantity: 2, unitPrice: 350, irregularReason: "余剰・形の不揃い" },
] as const;

export async function seedDemoData(prisma: PrismaClient) {
  const availableDate = jstDate(2);
  await prisma.$transaction(async (tx) => {
    for (const d of DEMO) {
      const producerId = `demo-producer-${d.key}`;
      await tx.producer.upsert({ where: { id: producerId }, create: { id: producerId, name: d.name }, update: { name: d.name } });
      const listing = {
        producerId,
        item: "トマト",
        variety: null,
        quantity: d.quantity,
        unit: "kg",
        unitPrice: d.unitPrice,
        availableDate,
        region: "大阪近郊",
        irregularReason: d.irregularReason,
        handoverPlace: DEMO_PLACE,
        handoverStart: "10:00",
        handoverEnd: "11:00",
        minQuantity: 1,
        step: 1,
        handoverFee: 0,
        isPublic: true,
      };
      const id = `demo-listing-${d.key}`;
      await tx.listing.upsert({ where: { id }, create: { id, ...listing }, update: listing });
    }
  });
  return { availableDate };
}
