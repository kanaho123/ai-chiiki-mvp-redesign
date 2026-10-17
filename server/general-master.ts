import type { PrismaClient } from "./generated/prisma/client.js";
import { upcomingOccurrences } from "./service-time.js";

// 一般ユーザー向けの環境の「マスタ・運営データ」だけを作る（デモ用のユーザー・在庫・依頼は作らない）。
// ・品目（出品できるのはここにある品目だけ）と、各品目の品種「指定なし」
// ・受渡拠点と定期枠（運営が管理。生産者は自由に作らず、ここから参加する）
// ・定期枠から作る実際の受渡の回（HandoverSlot）。何度実行しても重複しない（seriesId＋開始時刻で一意）
// 受渡拠点の名前は実在の事業者と紛れないよう、地域名＋「（仮）」にしている。

export const GENERAL_ITEMS = ["トマト", "なす", "きゅうり", "葉物", "根菜", "玉ねぎ"] as const;
export const DEFAULT_VARIETY = "指定なし";

export const GENERAL_PLACES = [
  { id: "place-umeda", name: "梅田エリア受渡所（仮）", address: "大阪市北区（詳しい場所は確定後にご案内します）", short: "梅田" },
  { id: "place-tennoji", name: "天王寺エリア受渡所（仮）", address: "大阪市天王寺区（詳しい場所は確定後にご案内します）", short: "天王寺" },
] as const;

// 曜日 0=日〜6=土、時刻は Asia/Tokyo。確認締切は開始の17時間前（午前10時の回なら前日17時）
export const GENERAL_SERIES = [
  { id: "series-umeda-tue-am", placeId: "place-umeda", label: "毎週火曜 午前", weekday: 2, startTime: "10:00", endTime: "11:00", deadlineHours: 17, feeYen: 800, maxKg: 20 },
  { id: "series-umeda-fri-am", placeId: "place-umeda", label: "毎週金曜 午前", weekday: 5, startTime: "10:00", endTime: "11:00", deadlineHours: 17, feeYen: 800, maxKg: 20 },
  { id: "series-tennoji-wed-pm", placeId: "place-tennoji", label: "毎週水曜 午後", weekday: 3, startTime: "14:00", endTime: "15:00", deadlineHours: 21, feeYen: 800, maxKg: 20 },
] as const;

/** 定期枠から何日先までの回を作るか */
export const MATERIALIZE_DAYS = 28;

const WEEKDAY = "日月火水木金土";

export async function seedGeneralMaster(prisma: PrismaClient, now: Date) {
  const result = { items: 0, varieties: 0, places: 0, series: 0, slotsCreated: 0, participantsAdded: 0 };
  // 品目と「指定なし」
  for (const name of GENERAL_ITEMS) {
    const item = await prisma.item.upsert({ where: { name }, update: {}, create: { name } });
    await prisma.variety.upsert({ where: { itemId_name: { itemId: item.id, name: DEFAULT_VARIETY } }, update: {}, create: { itemId: item.id, name: DEFAULT_VARIETY } });
    result.items++;
    result.varieties++;
  }
  // 受渡拠点
  for (const p of GENERAL_PLACES) {
    await prisma.place.upsert({ where: { id: p.id }, update: { name: p.name, address: p.address }, create: { id: p.id, name: p.name, address: p.address } });
    result.places++;
  }
  // 定期枠と、実際の回
  for (const s of GENERAL_SERIES) {
    const { id, ...data } = s;
    await prisma.slotSeries.upsert({ where: { id }, update: data, create: { id, ...data } });
    result.series++;
    const place = GENERAL_PLACES.find((p) => p.id === s.placeId)!;
    const members = await prisma.slotSeriesParticipant.findMany({ where: { seriesId: id }, select: { producerId: true } });
    for (const o of upcomingOccurrences(s, now, MATERIALIZE_DAYS)) {
      const existing = await prisma.handoverSlot.findUnique({ where: { seriesId_startAt: { seriesId: id, startAt: o.startAt } }, select: { id: true } });
      const slot = existing ?? await prisma.handoverSlot.create({
        data: {
          placeId: s.placeId, seriesId: id, label: `${place.short}・${WEEKDAY[s.weekday]}${s.startTime}`,
          startAt: o.startAt, endAt: o.endAt, confirmDeadlineAt: o.confirmDeadlineAt,
          feeYen: s.feeYen, feeConfirmed: true, maxKg: s.maxKg, conditionsConfirmed: true,
        },
        select: { id: true },
      });
      if (!existing) result.slotsCreated++;
      // 定期枠に参加している生産者を、その回の参加者にする（二重登録はしない）
      if (members.length > 0) {
        const r = await prisma.slotParticipant.createMany({ data: members.map((m) => ({ slotId: slot.id, producerId: m.producerId, confirmed: true })), skipDuplicates: true });
        result.participantsAdded += r.count;
      }
    }
  }
  return result;
}
