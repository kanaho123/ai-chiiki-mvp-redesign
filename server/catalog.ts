import { NEARBY_PREFECTURES, PREFECTURES } from "../src/lib/constants.js";
import type { Catalog } from "../src/lib/resolve.js";
import { prisma } from "./db.js";

export type CatalogResponse = Catalog & {
  nearbyPrefectures: readonly string[];
  slots: (Catalog["slots"][number] & { confirmDeadlineAt: string; feeYen: number; feeConfirmed: boolean; maxKg: number })[];
};

/** 条件確認に使う登録データ（品目・品種・産地・受渡枠・この店の取引済み農家）。AI には作らせない */
export async function loadCatalog(restaurantUserId: string): Promise<CatalogResponse> {
  const [items, slots, relationships, producers] = await Promise.all([
    prisma.item.findMany({ include: { varieties: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.handoverSlot.findMany({ include: { place: true }, orderBy: [{ startAt: "asc" }, { label: "asc" }] }),
    prisma.relationship.findMany({ where: { restaurantUserId, priorTrade: true }, include: { producer: true }, orderBy: { producerId: "asc" } }),
    prisma.producer.findMany({ select: { id: true, farmName: true }, orderBy: { id: "asc" } }),
  ]);
  return {
    items: items.map((i) => ({ id: i.id, name: i.name, varieties: i.varieties.map((v) => ({ id: v.id, name: v.name })) })),
    slots: slots.map((s) => ({
      id: s.id, label: s.label, placeName: s.place.name, placeAddress: s.place.address, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(),
      confirmDeadlineAt: s.confirmDeadlineAt.toISOString(), feeYen: s.feeYen, feeConfirmed: s.feeConfirmed, maxKg: s.maxKg,
    })),
    prefectures: PREFECTURES,
    nearbyPrefectures: NEARBY_PREFECTURES,
    // 優先指定は取引経験のある農家だけ（仕様 9.3-7）
    priorTradeProducers: relationships.map((r) => ({ id: r.producerId, name: r.producer.farmName })),
    producers: producers.map((p) => ({ id: p.id, name: p.farmName })),
  };
}
