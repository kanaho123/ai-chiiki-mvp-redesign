import type { PlanRequest, PlanResult } from "./allocate.js";

// 条件を満たせなかったとき、「利用者が自分で変更できる候補」だけを返す。
// 条件を自動で緩和・適用しない（画面で利用者が選び、内容を確認してから再計算する）。

export type SuggestionType =
  | "allow_first_time"
  | "allow_irregular"
  | "allow_mixed_varieties"
  | "allow_mixed_grades"
  | "review_budget"
  | "reduce_quantity"
  | "change_slot";

export type Suggestion = {
  type: SuggestionType;
  label: string;
  /** 利用者が選んだときにフォームへ反映する変更。null は利用者が値を入力する */
  change: Partial<PlanRequest> | null;
};

export function suggestConditionChanges(req: PlanRequest, plan: PlanResult): Suggestion[] {
  if (plan.status === "MATCHED") return [];
  const out: Suggestion[] = [];
  const codes = new Set(plan.reasonCodes);
  const details = new Set(plan.excluded.filter((e) => !e.details.includes("OTHER_SLOT")).flatMap((e) => e.details));

  if (!req.allowFirstTime && details.has("FIRST_TIME"))
    out.push({ type: "allow_first_time", label: "初回の農家を含める", change: { allowFirstTime: true } });
  if (!req.allowIrregular && details.has("IRREGULAR_NOT_ALLOWED"))
    out.push({ type: "allow_irregular", label: "規格外（形の不揃い等）を許可する", change: { allowIrregular: true } });
  // 品種・規格を「まぜてよいか」は飲食店に聞かない（品種の指定・規格外の可否から決まる）ので、混在を許可する候補は出さない
  if (codes.has("OVER_BUDGET")) out.push({ type: "review_budget", label: "予算を見直す", change: null });
  if (plan.fulfilledKg > 0 && plan.shortageKg > 0)
    out.push({ type: "reduce_quantity", label: `数量を${plan.fulfilledKg}kgに変更する`, change: { quantityKg: plan.fulfilledKg } });
  if (codes.has("HANDOVER_MISMATCH") || codes.has("DEADLINE_PASSED") || codes.has("SLOT_WEIGHT_LIMIT"))
    out.push({ type: "change_slot", label: "受渡枠・受取日を選び直す", change: null });
  return out;
}
