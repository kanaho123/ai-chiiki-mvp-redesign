import { PICKUP_LIMITS, weeklyText, type PickupPointInput } from "../src/lib/pickup.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { ensureUpcomingSlots } from "./general-master.js";
import { OnboardingProblem } from "./onboarding.js";

// 生産者が登録する「受け渡し可能地点」。既存の Place（場所）＋ SlotSeries（毎週の受渡枠）＋ SlotSeriesParticipant（参加）として保存し、
// 実際の回（HandoverSlot）と回への参加は既存の ensureUpcomingSlots で作る。仕入れ案の計算・依頼の仕組みは変えない。
// ・受け渡し費用は 0 円（普段の行動のついでの受け渡しで、運営の拠点の費用ではない）
// ・確認の締切は、既存の定期枠と同じく受け渡し開始の 17 時間前
// ・ほかの農家が登録した地点は、既存の「参加する受渡枠」から選んで参加できる（同じ場所でまとめて受け取れるようにするため）

export const PICKUP_DEADLINE_HOURS = 17;
export const PICKUP_MAX_KG = 100;

export type MyPickupPoint = {
  placeId: string; name: string; address: string; kind: string | null; note: string | null;
  series: { id: string; weekday: number; startTime: string; endTime: string; active: boolean; joined: boolean }[];
};

/** 本人が登録した地点（とその毎週の受け渡し枠） */
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

/** 地点を登録し、毎週の受け渡し枠を作って本人を参加させる。その後、既存の処理でこれからの回を作る */
export async function createPickupPoint(db: PrismaClient, userId: string, input: PickupPointInput, now: Date) {
  const created = await db.$transaction(async (tx) => {
    const producer = await tx.producer.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
    if (!producer) throw new OnboardingProblem(404, "生産者の登録が見つかりません");
    const count = await tx.place.count({ where: { ownerProducerId: producer.id } });
    if (count >= PICKUP_LIMITS.perProducer) throw new OnboardingProblem(400, `受け渡し可能地点は${PICKUP_LIMITS.perProducer}か所まで登録できます`);
    const place = await tx.place.create({ data: { name: input.name, address: input.address, kind: input.kind, note: input.note, ownerProducerId: producer.id } });
    const series = await tx.slotSeries.create({
      data: {
        placeId: place.id, label: weeklyText(input), weekday: input.weekday, startTime: input.startTime, endTime: input.endTime,
        deadlineHours: PICKUP_DEADLINE_HOURS, feeYen: 0, maxKg: PICKUP_MAX_KG, active: true,
      },
    });
    await tx.slotSeriesParticipant.create({ data: { seriesId: series.id, producerId: producer.id } });
    return { placeId: place.id, seriesId: series.id };
  }, { timeout: 20_000, maxWait: 10_000 });
  // これからの回を作り、参加者（本人）を回に加える（既存の補充処理。何度呼んでも重複しない）
  await ensureUpcomingSlots(db, now, { force: true });
  return created;
}

// ── 生産者向けの簡単な登録（「普段、野菜をどこで渡せますか？」→「いつ渡せますか？」）で使う ──

/** ほかの農家にも場所の候補として見せてよい種類（直売所・集荷場・出荷先）。農園・その他は私的な場所のことがあるので、登録した本人にだけ見せる */
export const PUBLIC_PLACE_KINDS = ["direct_store", "collection_point", "shipping_destination"] as const;

export type UsualPlace = { placeId: string; name: string; address: string; kind: string | null; times: { seriesId: string; weekday: number; startTime: string; endTime: string; active: boolean }[] };
export type PlaceCandidate = { placeId: string; name: string; address: string; kind: string | null };

const visibleTo = (producerId: string) => ({
  OR: [{ ownerProducerId: null }, { ownerProducerId: producerId }, { kind: { in: [...PUBLIC_PLACE_KINDS] } }],
});

/** いつもの受け渡し場所：本人が渡せる場所と曜日・時間（自分で登録した場所も、すでにあった場所も同じに扱う） */
export async function usualPlaces(db: PrismaClient, producerId: string): Promise<UsualPlace[]> {
  const rows = await db.slotSeriesParticipant.findMany({
    where: { producerId },
    select: { series: { select: { id: true, weekday: true, startTime: true, endTime: true, active: true, place: { select: { id: true, name: true, address: true, kind: true } } } } },
  });
  const byPlace = new Map<string, UsualPlace>();
  for (const { series: s } of rows) {
    const p = byPlace.get(s.place.id) ?? { placeId: s.place.id, name: s.place.name, address: s.place.address, kind: s.place.kind, times: [] };
    p.times.push({ seriesId: s.id, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, active: s.active });
    byPlace.set(s.place.id, p);
  }
  const weekdayOrder = (d: number) => (d + 6) % 7; // 月曜はじまり
  return [...byPlace.values()]
    .map((p) => ({ ...p, times: p.times.sort((a, b) => weekdayOrder(a.weekday) - weekdayOrder(b.weekday) || a.startTime.localeCompare(b.startTime)) }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/**
 * 「場所を教えてください」で出す、すでにある場所の候補。
 * 住所は、運営の場所・自分が登録した場所・自分が参加している場所だけ。ほかの生産者が登録した直売所などは名前と種類だけ（住所は空）
 */
export async function placeCandidates(db: PrismaClient, producerId: string): Promise<PlaceCandidate[]> {
  const places = await db.place.findMany({
    where: visibleTo(producerId),
    select: { id: true, name: true, address: true, kind: true, ownerProducerId: true, series: { where: { participants: { some: { producerId } } }, select: { id: true }, take: 1 } },
    orderBy: { name: "asc" },
  });
  return places.map((p) => {
    const mayShowAddress = p.ownerProducerId === null || p.ownerProducerId === producerId || p.series.length > 0;
    return { placeId: p.id, name: p.name, address: mayShowAddress ? p.address : "", kind: p.kind };
  });
}

/**
 * すでにある場所で「ここで渡せる」。本人の曜日・時間で受け渡せるようにする（ほかの農家の時間に合わせさせない）。
 * ・同じ場所・曜日・時間の毎週の枠があれば、それに加わる（同じ回にまとまるので、飲食店は1か所で受け取れる）
 * ・なければ、その場所に新しく毎週の枠を作る（生産者が登録した場所は受け渡し費用 0 円。はじめからある場所は、その場所の条件にそろえる）
 */
export async function useExistingPlace(db: PrismaClient, userId: string, input: { placeId: string; weekday: number; startTime: string; endTime: string }, now: Date) {
  const result = await db.$transaction(async (tx) => {
    const producer = await tx.producer.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
    if (!producer) throw new OnboardingProblem(404, "生産者の登録が見つかりません");
    const place = await tx.place.findFirst({ where: { id: input.placeId, ...visibleTo(producer.id) }, select: { id: true, ownerProducerId: true, series: { select: { feeYen: true, deadlineHours: true, maxKg: true }, orderBy: { id: "asc" }, take: 1 } } });
    if (!place) throw new OnboardingProblem(404, "その場所が見つかりません。選び直してください");
    const same = await tx.slotSeries.findFirst({ where: { placeId: place.id, weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, active: true }, select: { id: true } });
    const terms = place.ownerProducerId ? { feeYen: 0, deadlineHours: PICKUP_DEADLINE_HOURS, maxKg: PICKUP_MAX_KG } : (place.series[0] ?? { feeYen: 0, deadlineHours: PICKUP_DEADLINE_HOURS, maxKg: PICKUP_MAX_KG });
    const seriesId = same?.id ?? (await tx.slotSeries.create({
      data: { placeId: place.id, label: weeklyText(input), weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, active: true, ...terms },
      select: { id: true },
    })).id;
    await tx.slotSeriesParticipant.createMany({ data: [{ seriesId, producerId: producer.id }], skipDuplicates: true });
    return { placeId: place.id, seriesId, joinedExisting: !!same };
  }, { timeout: 20_000, maxWait: 10_000 });
  // これからの回を作り、参加者（本人）をこれからの回に加える（既存の補充処理。何度呼んでも重複しない）
  await ensureUpcomingSlots(db, now, { force: true });
  return result;
}
