import type { PrismaClient } from "./generated/prisma/client.js";
import { upcomingOccurrences } from "./service-time.js";

// 一般ユーザー向けの環境の「マスタ・運営データ」だけを作る（デモ用のユーザー・在庫・依頼は作らない）。
// ・品目（出品できるのはここにある品目だけ）と、各品目の品種「指定なし」
// ・受渡拠点と定期枠（運営が管理。生産者は自由に作らず、ここから参加する）
// ・定期枠から作る実際の受渡の回（HandoverSlot）。何度実行しても重複しない（seriesId＋開始時刻で一意）
// 受渡拠点の名前は実在の事業者と紛れないよう、地域名＋「（仮）」にしている。
// SlotSeries.active=false の定期枠（運営が止めたもの）は、新しい受渡の回を作らない。
// すでに作った回・参加者はそのまま残す（自動で削除・取り消ししない）。active は seed で上書きしない（運営が DB で切り替える）。

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

/** 最後の回がこれより近くなったら補充する（日） */
export const REFILL_WHEN_DAYS_LEFT = 21;
const DAY_MS = 86_400_000;
/** 「梅田エリア受渡所（仮）」→「梅田」（受渡の回の短い名前に使う） */
export const shortPlaceName = (name: string) => name.replace(/(エリア)?受渡所.*$/, "") || name;

/**
 * 運営が有効にしている定期枠（SlotSeries.active=true）から、これから MATERIALIZE_DAYS 日分の受渡の回を補充する。
 * ・何度実行しても同じ（定期枠＋開始時刻の一意制約と skipDuplicates で重複を作らない。同時に実行されても安全）
 * ・active=false の定期枠からは新しく作らない
 * ・すでにある回・参加者は削除も変更もしない（定期枠の参加者を、これからの回の参加者に加えるだけ）
 * ・曜日・時刻は Asia/Tokyo（server/service-time.ts）
 * force=false のときは、最後の回がまだ REFILL_WHEN_DAYS_LEFT 日より先にある定期枠を飛ばす（ふだんの画面表示から呼ぶため）
 */
export async function ensureUpcomingSlots(prisma: PrismaClient, now: Date, opts: { force?: boolean } = {}) {
  const result = { activeSeries: 0, refilledSeries: 0, slotsCreated: 0, participantsAdded: 0 };
  const series = await prisma.slotSeries.findMany({
    where: { active: true },
    select: {
      id: true, placeId: true, weekday: true, startTime: true, endTime: true, deadlineHours: true, feeYen: true, maxKg: true,
      place: { select: { name: true } },
      slots: { select: { startAt: true }, orderBy: { startAt: "desc" }, take: 1 },
      participants: { select: { producerId: true } },
    },
  });
  const threshold = now.getTime() + REFILL_WHEN_DAYS_LEFT * DAY_MS;
  for (const s of series) {
    result.activeSeries++;
    const last = s.slots[0]?.startAt;
    if (!opts.force && last && last.getTime() > threshold) continue;
    const occurrences = upcomingOccurrences(s, now, MATERIALIZE_DAYS);
    if (occurrences.length === 0) continue;
    result.refilledSeries++;
    const label = `${shortPlaceName(s.place.name)}・${WEEKDAY[s.weekday]}${s.startTime}`;
    const created = await prisma.handoverSlot.createMany({
      data: occurrences.map((o) => ({
        placeId: s.placeId, seriesId: s.id, label, startAt: o.startAt, endAt: o.endAt, confirmDeadlineAt: o.confirmDeadlineAt,
        feeYen: s.feeYen, feeConfirmed: true, maxKg: s.maxKg, conditionsConfirmed: true,
      })),
      skipDuplicates: true,
    });
    result.slotsCreated += created.count;
    // 定期枠に参加している生産者を、これからの回の参加者にする（二重登録はしない）
    if (s.participants.length > 0) {
      const slots = await prisma.handoverSlot.findMany({ where: { seriesId: s.id, startAt: { in: occurrences.map((o) => o.startAt) } }, select: { id: true } });
      const r = await prisma.slotParticipant.createMany({
        data: slots.flatMap((slot) => s.participants.map((m) => ({ slotId: slot.id, producerId: m.producerId, confirmed: true }))),
        skipDuplicates: true,
      });
      result.participantsAdded += r.count;
    }
  }
  return result;
}

export async function seedGeneralMaster(prisma: PrismaClient, now: Date) {
  const result = { items: 0, varieties: 0, places: 0, series: 0, inactiveSeries: 0, slotsCreated: 0, participantsAdded: 0 };
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
  // 定期枠（active は上書きしない）
  for (const s of GENERAL_SERIES) {
    const { id, ...data } = s;
    const row = await prisma.slotSeries.upsert({ where: { id }, update: data, create: { id, ...data }, select: { active: true } });
    result.series++;
    if (!row.active) result.inactiveSeries++;
  }
  // 実際の回（ふだんの補充と同じ処理。seed では日数に関係なく必ず確かめる）
  const r = await ensureUpcomingSlots(prisma, now, { force: true });
  result.slotsCreated = r.slotsCreated;
  result.participantsAdded = r.participantsAdded;
  return result;
}
