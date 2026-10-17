import type { ExclusionDetail, NoticeCode, ReasonCode } from "../../lib/allocate.js";
import { RESOLVE_NOTICE_TEXT, type ResolveNotice } from "../../lib/resolve.js";

// 画面表示用の言い換え（内部の理由コード・lib/reasons.ts の文言は変えない）。
// 専門用語（受渡枠・初回・混在など）を平易な言葉にするだけで、意味は足さない・変えない。

export const PLAIN_REASON: Record<ReasonCode, string> = {
  INSUFFICIENT_QUANTITY: "この条件で、最大3つの農家を組み合わせても、希望の量に届きません",
  OVER_BUDGET: "量はありますが、予算内に収まる組み合わせがありません",
  LOT_CONSTRAINT: "農家ごとの最低販売量と1kg単位の決まりがあるため、希望の量ちょうどにはできません",
  HANDOVER_MISMATCH: "希望する受け取り時間と場所に合いません",
  DEADLINE_PASSED: "受け取り時間と場所の確認締切を過ぎています",
  SEARCH_SCOPE_LIMIT: "4つ以上の農家を組み合わせれば揃う可能性がありますが、今回は最大3つの農家までで探しています",
  FIRST_TIME_EXCLUDED: "「初めて取引する農家を含めない」条件のため、候補に入らなかった在庫があります",
  PRODUCT_MISMATCH: "品目・産地・品種・規格のどれかが条件と合わない在庫があります",
  FEE_UNCONFIRMED: "受け渡し費用がまだ確認できていないため、合計が決まっていません（予算内かどうかも判定していません）",
  SLOT_CONDITIONS_UNCONFIRMED: "受け取り時間と場所の条件が、まだ確認できていません",
  PARTICIPATION_UNCONFIRMED: "この生産者がこの受け取り時間と場所に参加できるか、確認が必要です",
  SLOT_WEIGHT_LIMIT: "受け取り時間と場所ごとの重さの上限を超えるため、希望の量では組めません",
  TOO_MANY_SUPPLIES: "候補の在庫が多すぎるため計算していません。条件を絞ってください",
  MIXING_NOT_ALLOWED: "品種・規格をまぜない条件のため、違う品種・規格の在庫は合わせていません",
  UNAVAILABLE: "公開を止めている、または販売できる量が0kgの在庫があります",
};

/** 候補に入らなかった理由（「〜ため」で終わる。表示時に「今回は候補に入りませんでした」を続ける） */
export const PLAIN_EXCLUSION: Record<ExclusionDetail, string> = {
  NOT_PUBLISHED: "公開を止めているため",
  NO_STOCK: "販売できる量が0kgのため",
  ITEM_MISMATCH: "品目が違うため",
  ORIGIN_MISMATCH: "産地が条件と違うため",
  VARIETY_MISMATCH: "品種が違い、品種をまぜない条件のため",
  IRREGULAR_NOT_ALLOWED: "規格外品で、規格外を含めない条件のため",
  OTHER_SLOT: "受け取り時間と場所が希望と合わないため",
  SLOT_NOT_FOUND: "受け取り時間と場所が見つからないため",
  SLOT_DATE_MISMATCH: "受け取りの日付が希望日と違うため",
  NOT_SLOT_PARTICIPANT: "この受け取り時間と場所への参加が確認されていないため",
  DEADLINE_PASSED: "受け取り時間と場所の確認締切を過ぎているため",
  FIRST_TIME: "初めて取引する農家で、初めての農家を含めない条件のため",
  MIN_EXCEEDS_STOCK: "最低販売量が、販売できる量より多いため",
  MIN_EXCEEDS_REQUEST: "最低販売量が、希望の量より多いため",
  MIN_EXCEEDS_SLOT_LIMIT: "最低販売量が、受け取りの重さの上限より多いため",
};

export const exclusionSentence = (details: ExclusionDetail[]) => `${details.map((d) => PLAIN_EXCLUSION[d]).join("、")}、今回は候補に入りませんでした`;

export const PLAIN_NOTICE: Record<NoticeCode, string> = {
  PREFERRED_NOT_PRIOR_TRADE: "優先できるのは取引経験のある農家だけです。今回は優先なしで計算しました",
  PREFERRED_NOT_AVAILABLE: "優先した農家の在庫は、この条件では使えませんでした",
};

/** 条件確認画面のお知らせ（受渡枠などの用語だけ言い換え、それ以外は元の文のまま） */
const PLAIN_RESOLVE: Partial<Record<ResolveNotice, string>> = {
  HANDOVER_AMBIGUOUS: "受け取り場所に合う候補が複数あります。選んでください",
  HANDOVER_NOT_FOUND: "受け取り場所に合う候補が見つかりませんでした。一覧から選んでください",
  BUDGET_EXCLUDES_FEE: "予算は「受け渡し費用を含めた合計」で判定します。金額を確認してください",
};
export const plainResolveNotice = (n: ResolveNotice) => PLAIN_RESOLVE[n] ?? RESOLVE_NOTICE_TEXT[n];
