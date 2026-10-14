import { createPlan, type PlanRequest, type PlanResult, type SupplyListing } from "./allocate.js";

/** 不足時の条件変更候補（今は「規格外を許容する」だけ） */
export type Suggestion = {
  type: "allow_irregular";
  message: string;
  /** 候補の案に含まれる規格外の出品 */
  irregular: { producerName: string; quantity: number; unit: string; reason: string }[];
};

/**
 * 規格外不可で希望量に届かなかったとき、他の条件は変えずに規格外可で計算し直し、
 * 希望量を満たせる場合だけ案内を返す。在庫は変更しない。
 */
export function suggestAllowIrregular(
  req: PlanRequest,
  plan: PlanResult,
  listings: SupplyListing[],
  today: string,
): Suggestion | null {
  if (plan.status === "fulfilled" || req.allowIrregular) return null;

  const alt = createPlan({ ...req, allowIrregular: true }, listings, today);
  if (alt.status !== "fulfilled") return null;

  const irregular = alt.allocations
    .filter((a) => a.irregularReason)
    .map((a) => ({ producerName: a.producerName, quantity: a.quantity, unit: alt.unit, reason: a.irregularReason! }));
  // 規格外を使わずに満たせるなら、規格外の許容は不足の解決にならない（通常はここに来ない）
  if (irregular.length === 0) return null;

  const parts = irregular.map((i) => `${i.producerName}の${i.quantity}${i.unit}（${i.reason}）`).join("、");
  return {
    type: "allow_irregular",
    message: `形の不揃いなどの規格外品も許容すると、${parts}を含めて希望${req.quantity}${req.unit}を満たす案を作れます`,
    irregular,
  };
}
