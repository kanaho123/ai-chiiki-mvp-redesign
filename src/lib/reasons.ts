import type { ExclusionDetail, NoticeCode, PlanResult, PlanStatus, RankingReason, ReasonCode } from "./allocate.js";

// 理由コードから利用者向けの定型文へ変換する。
// 検索範囲（この条件・登録済みの供給・最大3農家）を超えた断定（「地域に在庫がない」等）はしない。

export const STATUS_TEXT: Record<PlanStatus, string> = {
  MATCHED: "登録条件に適合",
  NEEDS_CONFIRMATION: "確認が必要",
  NOT_MATCHED: "条件を満たさない",
};

export const REASON_TEXT: Record<ReasonCode, string> = {
  INSUFFICIENT_QUANTITY: "この条件・最大3農家では必要量を満たせません",
  OVER_BUDGET: "数量はありますが、予算内の案がありません",
  LOT_CONSTRAINT: "最低販売量・1kg刻みの条件により、希望数量ちょうどにできません",
  HANDOVER_MISMATCH: "希望する受渡枠と条件が一致しません",
  DEADLINE_PASSED: "受渡枠の確認締切を過ぎています",
  SEARCH_SCOPE_LIMIT: "4農家以上を組み合わせれば揃う可能性がありますが、今回の対応範囲は最大3農家までです",
  FIRST_TIME_EXCLUDED: "初回の農家を含めない条件のため、対象外の供給があります",
  PRODUCT_MISMATCH: "品目・産地・品種・規格のいずれかが条件と一致しない供給があります",
  FEE_UNCONFIRMED: "受渡費用が未確認のため、総額が確定していません（予算内かどうかは判定していません）",
  SLOT_CONDITIONS_UNCONFIRMED: "受渡枠の条件が未確認です",
  PARTICIPATION_UNCONFIRMED: "この生産者の受渡枠への参加確認が必要です",
  SLOT_WEIGHT_LIMIT: "受渡枠の重量上限を超えるため、希望数量では組めません",
  TOO_MANY_SUPPLIES: "対象の供給が多すぎるため計算していません。条件を絞ってください",
  MIXING_NOT_ALLOWED: "品種・規格の混在を許可していないため、異なる品種・規格の供給は合算していません",
  UNAVAILABLE: "公開停止中または販売可能量0kgの供給があります",
};

export const EXCLUSION_TEXT: Record<ExclusionDetail, string> = {
  NOT_PUBLISHED: "公開停止中",
  NO_STOCK: "販売可能量が0kg",
  ITEM_MISMATCH: "品目が異なる",
  ORIGIN_MISMATCH: "産地が条件と異なる",
  VARIETY_MISMATCH: "品種が異なる（混在を許可していない）",
  IRREGULAR_NOT_ALLOWED: "規格外品（規格外を許可していない）",
  OTHER_SLOT: "別の受渡枠（同じ案には組み合わせない）",
  SLOT_NOT_FOUND: "受渡枠が見つからない",
  SLOT_DATE_MISMATCH: "受渡枠の日付が希望日と異なる",
  NOT_SLOT_PARTICIPANT: "この受渡枠への参加が確認されていない",
  DEADLINE_PASSED: "受渡枠の確認締切を過ぎている",
  FIRST_TIME: "初回の農家（初回を含めない条件）",
  MIN_EXCEEDS_STOCK: "最低販売量が販売可能量を超えている",
  MIN_EXCEEDS_REQUEST: "最低販売量が希望数量を超えている",
  MIN_EXCEEDS_SLOT_LIMIT: "最低販売量が受渡枠の重量上限を超えている",
};

export const NOTICE_TEXT: Record<NoticeCode, string> = {
  PREFERRED_NOT_PRIOR_TRADE: "優先指定は取引経験のある農家だけに対応しています。今回は優先指定なしで計算しました",
  PREFERRED_NOT_AVAILABLE: "優先した農家の供給は、この条件では使えませんでした",
};

export function rankingText(r: RankingReason | null): string | null {
  if (!r) return null;
  const names = r.producerNames.join("・");
  switch (r.code) {
    case "SINGLE_PRODUCER":
      return `1農家（${names}）で揃うため、分割していません`;
    case "FEWER_PRODUCERS":
      return r.producerCount === 1
        ? `仕入れ先の数を優先したため、今回は${names}のみ`
        : `仕入れ先の数を優先したため、今回は${names}の${r.producerCount}農家`;
    case "PRIOR_TRADE_FIRST":
      return "取引経験のある農家からの数量を優先したため、最安の組み合わせではありません";
    case "SUPPLEMENTED":
      return `1農家では揃わないため、${names}の${r.producerCount}農家で補完しました`;
  }
}

/** 結果の見出し（例: 「この検索条件・最大3農家では9kg。1kg不足」） */
export function headlineText(p: PlanResult): string {
  if (p.status === "MATCHED") return `希望${p.requestedKg}kgを満たす案です`;
  if (p.status === "NEEDS_CONFIRMATION") return `${p.fulfilledKg}kgの案はありますが、確認が必要です`;
  if (p.reasonCodes.includes("TOO_MANY_SUPPLIES")) return "条件を絞ってください";
  if (p.fulfilledKg === 0) return "この条件で組める案はありません";
  if (p.reasonCodes.includes("OVER_BUDGET")) return `予算内では${p.fulfilledKg}kgまで。${p.shortageKg}kg不足`;
  return `この検索条件・最大3農家では${p.fulfilledKg}kg。${p.shortageKg}kg不足`;
}
