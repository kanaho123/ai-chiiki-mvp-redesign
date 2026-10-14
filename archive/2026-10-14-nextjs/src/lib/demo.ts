import type { PrismaClient } from "@prisma/client";
import { DEMO_PLACE } from "./constants";
import { jstDate } from "./dates";

// 仕様書8章のデモデータ（架空）。受渡は日本時間の「明後日」10〜11時、拠点P。
const DEMO = [
  { producerName: "A農家", quantity: 5, unitPrice: 600, irregularReason: null },
  { producerName: "B農家", quantity: 3, unitPrice: 550, irregularReason: null },
  { producerName: "C農家", quantity: 2, unitPrice: 350, irregularReason: "余剰・形の不揃い" },
];

export async function resetDemoData(prisma: PrismaClient) {
  const availableDate = jstDate(2);
  await prisma.$transaction(async (tx) => {
    await tx.listing.deleteMany();
    await tx.producer.deleteMany();
    for (const d of DEMO) {
      await tx.producer.create({
        data: {
          name: d.producerName,
          listings: {
            create: {
              item: "トマト",
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
            },
          },
        },
      });
    }
  });
}
