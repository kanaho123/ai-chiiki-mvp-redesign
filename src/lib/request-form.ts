import type { PlanRequest } from "./allocate.js";
import type { Draft, DraftField } from "./resolve.js";

// 条件確認フォームの値と、/api/plan へ送る内容の変換。
// 送るのは利用者が確認・修正した後のフォームの値だけ（AI の抽出結果を直接送らない）。

export type YesNo = "" | "yes" | "no";

export type RequestForm = {
  itemId: string;
  varietyId: string; // "" は指定なし
  quantityKg: string;
  desiredDate: string;
  budgetMode: "" | "limit" | "none";
  budgetYen: string;
  originPrefectures: string[];
  slotId: string;
  allowFirstTime: YesNo;
  allowIrregular: YesNo;
  allowMixedVarieties: YesNo;
  allowMixedGrades: YesNo;
  preferredProducerId: string;
};

/** 未選択のまま始める（重要な選択を勝手に false にしない） */
export const EMPTY_FORM: RequestForm = {
  itemId: "", varietyId: "", quantityKg: "", desiredDate: "", budgetMode: "", budgetYen: "", originPrefectures: [], slotId: "",
  allowFirstTime: "", allowIrregular: "", allowMixedVarieties: "", allowMixedGrades: "", preferredProducerId: "",
};

const yn = (v: YesNo) => (v === "" ? null : v === "yes");
const fromBool = (v: boolean | null): YesNo => (v === null ? "" : v ? "yes" : "no");

/** 未選択の項目は null／未入力のまま送り、サーバーで「選択してください」と返す（推測で埋めない） */
export function toPlanBody(f: RequestForm) {
  return {
    itemId: f.itemId,
    varietyId: f.varietyId || null,
    quantityKg: f.quantityKg,
    desiredDate: f.desiredDate,
    budgetYen: f.budgetMode === "none" ? null : f.budgetMode === "limit" ? f.budgetYen : undefined,
    originPrefectures: f.originPrefectures,
    slotId: f.slotId,
    allowFirstTime: yn(f.allowFirstTime),
    allowIrregular: yn(f.allowIrregular),
    allowMixedVarieties: yn(f.allowMixedVarieties),
    allowMixedGrades: yn(f.allowMixedGrades),
    preferredProducerId: f.preferredProducerId || null,
  };
}

export function formFromRequest(r: PlanRequest): RequestForm {
  return {
    itemId: r.itemId, varietyId: r.varietyId ?? "", quantityKg: String(r.quantityKg), desiredDate: r.desiredDate,
    budgetMode: r.budgetYen === null ? "none" : "limit", budgetYen: r.budgetYen === null ? "" : String(r.budgetYen),
    originPrefectures: r.originPrefectures, slotId: r.slotId, allowFirstTime: fromBool(r.allowFirstTime), allowIrregular: fromBool(r.allowIrregular),
    allowMixedVarieties: fromBool(r.allowMixedVarieties), allowMixedGrades: fromBool(r.allowMixedGrades), preferredProducerId: r.preferredProducerId ?? "",
  };
}

/** AI 抽出＋照合の結果を確認フォームの初期値にする（未確定は空のまま） */
export function formFromDraft(d: Draft): RequestForm {
  return {
    itemId: d.itemId ?? "", varietyId: d.varietyId ?? "", quantityKg: d.quantityKg === null ? "" : String(d.quantityKg),
    desiredDate: d.desiredDate ?? "", budgetMode: d.budget?.mode ?? "", budgetYen: d.budget?.mode === "limit" ? String(d.budget.yen) : "",
    originPrefectures: d.originPrefectures, slotId: d.slotId ?? "", allowFirstTime: fromBool(d.allowFirstTime),
    allowIrregular: fromBool(d.allowIrregular), allowMixedVarieties: fromBool(d.allowMixedVarieties), allowMixedGrades: fromBool(d.allowMixedGrades),
    preferredProducerId: d.preferredProducerId ?? "",
  };
}

/** まだ選択・入力されていない必須項目（画面で「要確認」を示す） */
export function missingFields(f: RequestForm): DraftField[] {
  const out: DraftField[] = [];
  if (!f.itemId) out.push("itemId");
  if (!f.quantityKg) out.push("quantityKg");
  if (!f.desiredDate) out.push("desiredDate");
  if (!f.budgetMode || (f.budgetMode === "limit" && !f.budgetYen)) out.push("budget");
  if (f.originPrefectures.length === 0) out.push("originPrefectures");
  if (!f.slotId) out.push("slotId");
  for (const k of ["allowFirstTime", "allowIrregular", "allowMixedVarieties", "allowMixedGrades"] as const) if (!f[k]) out.push(k);
  return out;
}
