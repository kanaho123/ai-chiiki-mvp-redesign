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
