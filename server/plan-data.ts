import { createHash } from "node:crypto";
import type { AllocateInput, PlanSlot, PlanSupply } from "../src/lib/allocate.js";
import { prisma } from "./db.js";
import type { Prisma } from "./generated/prisma/client.js";

export type PlanInputs = Omit<AllocateInput, "request" | "now">;

/**
 * 計算に使う最新データを1つのトランザクション（同じ時点のスナップショット）で読む。
 * 公開中の供給だけを使う。案を作っても数量は変更しない。
 */
export async function loadPlanInputs(q: { itemId: string; slotId: string; restaurantUserId: string /* ログイン中の飲食店。取引経験は店ごと */ }, transaction?: Prisma.TransactionClient): Promise<{ inputs: PlanInputs; version: string }> {
  if (!transaction) return prisma.$transaction((tx) => loadPlanInputs(q, tx), { isolationLevel: "RepeatableRead" });
  const [slot, supplies, participants, relationships] = await Promise.all(
    [
      transaction.handoverSlot.findUnique({ where: { id: q.slotId }, include: { place: true } }),
      transaction.supply.findMany({ where: { itemId: q.itemId, published: true }, include: { producer: true, variety: true }, orderBy: { id: "asc" } }),
      transaction.slotParticipant.findMany({ where: { slotId: q.slotId }, orderBy: { producerId: "asc" } }),
      transaction.relationship.findMany({ where: { restaurantUserId: q.restaurantUserId }, orderBy: { producerId: "asc" } }),
    ],
  );

  const planSlot: PlanSlot | null = slot && {
    id: slot.id, label: slot.label, placeName: slot.place.name, startAt: slot.startAt.toISOString(), endAt: slot.endAt.toISOString(),
    confirmDeadlineAt: slot.confirmDeadlineAt.toISOString(), feeYen: slot.feeYen, feeConfirmed: slot.feeConfirmed, maxKg: slot.maxKg,
    conditionsConfirmed: slot.conditionsConfirmed,
  };
  const planSupplies: PlanSupply[] = supplies.map((s) => ({
    id: s.id, producerId: s.producerId, producerName: s.producer.farmName, itemId: s.itemId, varietyId: s.varietyId,
    varietyName: s.variety.name, grade: s.grade, irregularReason: s.irregularReason, originPrefecture: s.originPrefecture,
    availableKg: s.availableKg, priceYenPerKg: s.priceYenPerKg, minKg: s.minKg, slotId: s.slotId, published: s.published,
    version: s.version, updatedAt: s.updatedAt.toISOString(),
  }));
  const inputs: PlanInputs = {
    supplies: planSupplies,
    slot: planSlot,
    participants: participants.map((p) => ({ slotId: p.slotId, producerId: p.producerId, confirmed: p.confirmed })),
    relationships: relationships.map((r) => ({ producerId: r.producerId, priorTrade: r.priorTrade })),
  };
  return { inputs, version: inputsVersion(inputs) };
}

/**
 * 計算結果を左右するデータの版。供給の id・version・公開状態、枠の費用・条件、参加確認、取引経験のどれかが
 * 変われば値が変わる。表示中の案の version と違えば、その案は古い。
 * Phase 3 の生産者更新では、Supply を更新するたびに version を +1 すること。
 */
export function inputsVersion(i: PlanInputs): string {
  const key = JSON.stringify({
    supplies: i.supplies.map((s) => [s.id, s.version, s.published, s.updatedAt]),
    slot: i.slot && [i.slot.id, i.slot.startAt, i.slot.endAt, i.slot.confirmDeadlineAt, i.slot.feeYen, i.slot.feeConfirmed, i.slot.maxKg, i.slot.conditionsConfirmed],
    participants: i.participants.map((p) => [p.producerId, p.confirmed]),
    relationships: i.relationships.map((r) => [r.producerId, r.priorTrade]),
  });
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
