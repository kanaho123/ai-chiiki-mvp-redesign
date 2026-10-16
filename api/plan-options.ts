import { NEARBY_PREFECTURES, PREFECTURES } from "../src/lib/constants.js";
import { isDemoClock, serverNow } from "../server/clock.js";
import { prisma } from "../server/db.js";
import { requireRole } from "../server/auth.js";
import { handle, json } from "../server/http.js";

// 手入力の条件確認に使う選択肢（品目・品種・受渡枠・産地・優先できる取引済み農家）。
export const GET = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const [items, slots, relationships] = await Promise.all([
    prisma.item.findMany({ include: { varieties: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.handoverSlot.findMany({ include: { place: true }, orderBy: [{ startAt: "asc" }, { label: "asc" }] }),
    prisma.relationship.findMany({ where: { restaurantUserId: g.user.id, priorTrade: true }, include: { producer: true } }),
  ]);
  return json({
    now: serverNow().toISOString(),
    demoClock: isDemoClock(),
    items: items.map((i) => ({ id: i.id, name: i.name, varieties: i.varieties.map((v) => ({ id: v.id, name: v.name })) })),
    slots: slots.map((s) => ({
      id: s.id, label: s.label, placeName: s.place.name, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(),
      confirmDeadlineAt: s.confirmDeadlineAt.toISOString(), feeYen: s.feeYen, feeConfirmed: s.feeConfirmed, maxKg: s.maxKg,
    })),
    prefectures: PREFECTURES,
    nearbyPrefectures: NEARBY_PREFECTURES,
    // 優先指定は取引済み農家だけ（仕様 9.3-7）
    priorTradeProducers: relationships.map((r) => ({ id: r.producerId, name: r.producer.farmName })),
  });
});
