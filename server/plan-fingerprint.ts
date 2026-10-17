import { createHash } from "node:crypto";
import type { PlanRequest, PlanResult } from "../src/lib/allocate.js";

/** Stable across recalculation timestamps, sensitive to conditions, allocations and inventory. */
export function planFingerprint(request: PlanRequest, version: string, plan: PlanResult): string {
  const canonicalRequest = {
    itemId: request.itemId, varietyId: request.varietyId, quantityKg: request.quantityKg,
    desiredDate: request.desiredDate, budgetYen: request.budgetYen,
    originPrefectures: [...request.originPrefectures].sort(), slotId: request.slotId,
    allowIrregular: request.allowIrregular, allowMixedVarieties: request.allowMixedVarieties,
    allowMixedGrades: request.allowMixedGrades, allowFirstTime: request.allowFirstTime,
    preferredProducerId: request.preferredProducerId,
  };
  return createHash("sha256").update(JSON.stringify({
    request: canonicalRequest, version, slot: plan.slot,
    allocations: [...plan.allocations].sort((a, b) => a.supplyId.localeCompare(b.supplyId)).map((a) => [a.supplyId, a.producerId, a.kg, a.priceYenPerKg, a.version]),
  })).digest("hex");
}
