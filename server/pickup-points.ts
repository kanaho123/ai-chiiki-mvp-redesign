import { HANDOVER_DEADLINE_HOURS, HANDOVER_PERIODS, handoverWindow, PICKUP_LIMITS, type HandoverInput, type PickupPointInput } from "../src/lib/pickup.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { shortPlaceName } from "./general-master.js";
import { OnboardingProblem } from "./onboarding.js";

// 生産者の「いつもの受け渡し場所」。登録するのは場所（種類・名前・住所）だけで、曜日・時間は聞かない（ProducerPlace）。
// 渡せる日と時間帯（午前／午後）は出品のときに選び、その場所・日時の受渡の回（HandoverSlot）を使う（なければ作る）。
// 仕入れ案の計算・依頼の仕組みは今までの受渡の回のまま変えない：
// ・同じ場所・同じ日時の回は1つにまとめる（複数の農家を束ねて、飲食店は1か所で受け取れる）
// ・生産者が登録した場所の受け渡し費用は 0 円。はじめからある場所（運営の拠点）は、その場所の毎週の枠の条件にそろえる
// ・確認の締切は、毎週の枠と同じく受け渡し開始の 17 時間前
// 2026-10-22 より前に曜日・時間つきで登録した場所（SlotSeries と SlotSeriesParticipant）は、そのまま残し、いつもの場所として扱う。

export const PICKUP_DEADLINE_HOURS = HANDOVER_DEADLINE_HOURS;
export const PICKUP_MAX_KG = 100;

export type MyPickupPoint = {
  placeId: string; name: string; address: string; kind: string | null; note: string | null;
  series: { id: string; weekday: number; startTime: string; endTime: string; active: boolean; joined: boolean }[];
};

/** 本人が登録した地点（と、以前に登録した毎週の受け渡し枠） */
export async function listMyPickupPoints(db: PrismaClient, producerId: string): Promise<MyPickupPoint[]> {
  const places = await db.place.findMany({
    where: { ownerProducerId: producerId },
    select: {
      id: true, name: true, address: true, kind: true, note: true,
      series: { select: { id: true, weekday: true, startTime: true, endTime: true, active: true, participants: { where: { producerId }, select: { producerId: true } } }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] },
    },
    orderBy: { name: "asc" },
  });
  return places.map((p) => ({
    placeId: p.id, name: p.name, address: p.address, kind: p.kind, note: p.note,
    series: p.series.map((s) => ({ id: s.id, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, active: s.active, joined: s.participants.length > 0 })),
  }));
}

/** 新しい場所を登録し、本人のいつもの場所にする（曜日・時間は持たない） */
export async function createPickupPoint(db: PrismaClient, userId: string, input: PickupPointInput) {
  return db.$transaction(async (tx) => {
    const producer = await tx.producer.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
    if (!producer) throw new OnboardingProblem(404, "生産者の登録が見つかりません");
    const count = await tx.place.count({ where: { ownerProducerId: producer.id } });
    if (count >= PICKUP_LIMITS.perProducer) throw new OnboardingProblem(400, `受け渡し可能地点は${PICKUP_LIMITS.perProducer}か所まで登録できます`);
    const place = await tx.place.create({ data: { name: input.name, address: input.address, kind: input.kind, note: input.note, ownerProducerId: producer.id } });
    await tx.producerPlace.create({ data: { producerId: producer.id, placeId: place.id } });
    return { placeId: place.id };
  }, { timeout: 20_000, maxWait: 10_000 });
}

// ── 生産者向けの簡単な登録（「普段、野菜をどこで渡せますか？」→ 場所の名前と住所）で使う ──

/** ほかの農家にも場所の候補として見せてよい種類（直売所・集荷場・出荷先）。農園・その他は私的な場所のことがあるので、登録した本人にだけ見せる */
export const PUBLIC_PLACE_KINDS = ["direct_store", "collection_point", "shipping_destination"] as const;

/** times は以前に曜日・時間つきで登録した場所のときだけ（新しく登録した場所は空） */
export type UsualPlace = { placeId: string; name: string; address: string; kind: string | null; times: { seriesId: string; weekday: number; startTime: string; endTime: string; active: boolean }[] };
export type PlaceCandidate = { placeId: string; name: string; address: string; kind: string | null };

const visibleTo = (producerId: string) => ({
  OR: [{ ownerProducerId: null }, { ownerProducerId: producerId }, { kind: { in: [...PUBLIC_PLACE_KINDS] } }],
});

/** いつもの受け渡し場所：場所だけで登録したもの（ProducerPlace）と、以前に曜日・時間つきで登録したもの（SlotSeriesParticipant）を合わせる */
export async function usualPlaces(db: PrismaClient, producerId: string): Promise<UsualPlace[]> {
  const placeSelect = { id: true, name: true, address: true, kind: true } as const;
  const [links, rows] = await Promise.all([
    db.producerPlace.findMany({ where: { producerId }, select: { place: { select: placeSelect } } }),
    db.slotSeriesParticipant.findMany({
      where: { producerId },
      select: { series: { select: { id: true, weekday: true, startTime: true, endTime: true, active: true, place: { select: placeSelect } } } },
    }),
  ]);
  const byPlace = new Map<string, UsualPlace>();
  const add = (p: { id: string; name: string; address: string; kind: string | null }) =>
    byPlace.get(p.id) ?? byPlace.set(p.id, { placeId: p.id, name: p.name, address: p.address, kind: p.kind, times: [] }).get(p.id)!;
  for (const { place } of links) add(place);
  for (const { series: s } of rows) add(s.place).times.push({ seriesId: s.id, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, active: s.active });
  const weekdayOrder = (d: number) => (d + 6) % 7; // 月曜はじまり
  return [...byPlace.values()]
    .map((p) => ({ ...p, times: p.times.sort((a, b) => weekdayOrder(a.weekday) - weekdayOrder(b.weekday) || a.startTime.localeCompare(b.startTime)) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/**
 * 「場所を教えてください」の下に出す、すでにある場所の候補。
 * 住所は、運営の場所・自分が登録した場所・自分が使っている場所だけ。ほかの生産者が登録した直売所などは名前と種類だけ（住所は空）
 */
export async function placeCandidates(db: PrismaClient, producerId: string): Promise<PlaceCandidate[]> {
  const places = await db.place.findMany({
    where: visibleTo(producerId),
    select: {
      id: true, name: true, address: true, kind: true, ownerProducerId: true,
      series: { where: { participants: { some: { producerId } } }, select: { id: true }, take: 1 },
      usedBy: { where: { producerId }, select: { producerId: true }, take: 1 },
    },
    orderBy: { name: "asc" },
  });
  return places.map((p) => {
    const mayShowAddress = p.ownerProducerId === null || p.ownerProducerId === producerId || p.series.length > 0 || p.usedBy.length > 0;
    return { placeId: p.id, name: p.name, address: mayShowAddress ? p.address : "", kind: p.kind };
  });
}

/** すでにある場所を「ここで渡せる」＝いつもの場所にする（曜日・時間は聞かない） */
export async function useExistingPlace(db: PrismaClient, userId: string, input: { placeId: string }) {
  return db.$transaction(async (tx) => {
    const producer = await tx.producer.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
    if (!producer) throw new OnboardingProblem(404, "生産者の登録が見つかりません");
    const place = await tx.place.findFirst({ where: { id: input.placeId, ...visibleTo(producer.id) }, select: { id: true } });
    if (!place) throw new OnboardingProblem(404, "その場所が見つかりません。選び直してください");
    await tx.producerPlace.createMany({ data: [{ producerId: producer.id, placeId: place.id }], skipDuplicates: true });
    return { placeId: place.id };
  }, { timeout: 20_000, maxWait: 10_000 });
}

/**
 * 出品のときの受け渡し（いつもの場所・渡せる日・時間帯）の受渡の回を返す。同じ場所・同じ日時の回があればそれを使い、なければ作る。
 * 本人をその回の参加者にする（出品の API は、参加している回にだけ出品できる）。いつもの場所でなければ断る
 */
export async function ensureHandoverSlot(db: PrismaClient, producerId: string, input: HandoverInput): Promise<string> {
  if (!(await usualPlaces(db, producerId)).some((p) => p.placeId === input.placeId)) {
    throw new OnboardingProblem(400, "いつもの受け渡し場所から選んでください");
  }
  const { startAt, endAt, confirmDeadlineAt } = handoverWindow(input.date, input.period);
  return db.$transaction(async (tx) => {
    const place = await tx.place.findUniqueOrThrow({
      where: { id: input.placeId },
      select: { name: true, ownerProducerId: true, series: { select: { feeYen: true, maxKg: true }, orderBy: { id: "asc" }, take: 1 } },
    });
    let slot = await tx.handoverSlot.findFirst({ where: { placeId: input.placeId, startAt, endAt }, select: { id: true }, orderBy: { id: "asc" } });
    if (!slot) {
      const terms = place.ownerProducerId ? { feeYen: 0, maxKg: PICKUP_MAX_KG } : (place.series[0] ?? { feeYen: 0, maxKg: PICKUP_MAX_KG });
      const [, m, d] = input.date.split("-").map(Number);
      const period = HANDOVER_PERIODS.find((h) => h.value === input.period)!.label;
      slot = await tx.handoverSlot.create({
        data: {
          placeId: input.placeId, label: `${shortPlaceName(place.name)}・${m}/${d}${period}`, startAt, endAt, confirmDeadlineAt,
          feeYen: terms.feeYen, feeConfirmed: true, maxKg: terms.maxKg, conditionsConfirmed: true,
        },
        select: { id: true },
      });
    }
    await tx.slotParticipant.createMany({ data: [{ slotId: slot.id, producerId, confirmed: true }], skipDuplicates: true });
    return slot.id;
  }, { timeout: 20_000, maxWait: 10_000 });
}
