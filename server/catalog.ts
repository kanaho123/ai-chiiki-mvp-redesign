import { NEARBY_PREFECTURES, PREFECTURES } from "../src/lib/constants.js";
import type { Catalog } from "../src/lib/resolve.js";
import { prisma } from "./db.js";

type CatalogSlot = Catalog["slots"][number] & { placeKind: string | null; confirmDeadlineAt: string; feeYen: number; feeConfirmed: boolean; maxKg: number };
export type CatalogResponse = Catalog & {
  nearbyPrefectures: readonly string[];
  slots: CatalogSlot[];
};

/** 飲食店に返すカタログ：受け渡しの場所の住所は返さない（画面でも使わない。生産者が登録した場所は自宅のこともあるため） */
export type PublicCatalog = Omit<CatalogResponse, "slots"> & { slots: Omit<CatalogSlot, "placeAddress">[] };
export function publicCatalog(c: CatalogResponse): PublicCatalog {
  const slots: CatalogSlot[] = c.slots;
  return { ...c, slots: slots.map(({ placeAddress: _hidden, ...s }) => s) };
}

/**
 * 条件確認に使う登録データ（品目・品種・産地・受渡枠・この店の取引済み農家）。AI には作らせない。
 * サーバーの中だけで使う（AI 読み取りの場所の照合）。飲食店へは publicCatalog で住所を外して返す。
 * 照合に使う住所は運営の場所だけ。生産者が登録した場所は住所を空にし、名前でだけ照合する
 * （飲食店が住所を書いて一致したことから、生産者の私的な場所を推測できないように）
 */
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
      id: s.id, label: s.label, placeName: s.place.name, placeAddress: s.place.ownerProducerId ? "" : s.place.address, placeKind: s.place.kind, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(),
      confirmDeadlineAt: s.confirmDeadlineAt.toISOString(), feeYen: s.feeYen, feeConfirmed: s.feeConfirmed, maxKg: s.maxKg,
    })),
    prefectures: PREFECTURES,
    nearbyPrefectures: NEARBY_PREFECTURES,
    // 優先指定は取引経験のある農家だけ（仕様 9.3-7）
    priorTradeProducers: relationships.map((r) => ({ id: r.producerId, name: r.producer.farmName })),
    producers: producers.map((p) => ({ id: p.id, name: p.farmName })),
  };
}
