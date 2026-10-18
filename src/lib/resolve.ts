import { formatDateJa, jstDate } from "./dates.js";
import type { ExtractedRequest } from "./validate.js";

// AI が抜き出した「文章中の生の値」を、登録済みデータ（品目・品種・産地・受渡枠・農家）の候補へ通常処理で照合する。
// ID は登録データからだけ選ぶ（一致しない名称を新規作成しない）。日付は基準日時（DEMO_NOW 等）と JST で候補を出す。
// ここで決まるのは「確認画面の初期値と候補」だけで、最終的な条件は利用者が確認・修正して確定する。

export type Catalog = {
  items: { id: string; name: string; varieties: { id: string; name: string }[] }[];
  slots: { id: string; label: string; placeName: string; placeAddress: string; startAt: string; endAt: string }[];
  prefectures: readonly string[];
  priorTradeProducers: { id: string; name: string }[]; // ログイン中の店の取引経験あり
  producers: { id: string; name: string }[]; // 名称照合用（優先指定できるかは priorTradeProducers で判断）
};

export type Candidate = { id: string; label: string };

/** 確認画面の初期値。未確定は null（利用者が選ぶ） */
export type Draft = {
  itemId: string | null;
  varietyId: string | null;
  quantityKg: number | null;
  desiredDate: string | null;
  budget: { mode: "limit"; yen: number } | { mode: "none" } | null;
  originPrefectures: string[];
  slotId: string | null;
  allowFirstTime: boolean | null;
  allowIrregular: boolean | null;
  allowMixedVarieties: boolean | null;
  allowMixedGrades: boolean | null;
  preferredProducerId: string | null;
};

export type DraftField = keyof Draft;

export type ResolveNotice =
  | "ITEM_NOT_FOUND" | "ITEM_AMBIGUOUS" | "VARIETY_NOT_FOUND" | "DATE_AMBIGUOUS" | "DATE_NOT_UNDERSTOOD" | "DATE_WEEKDAY_MISMATCH"
  | "ORIGIN_AMBIGUOUS" | "ORIGIN_NOT_FOUND" | "HANDOVER_AMBIGUOUS" | "HANDOVER_NOT_FOUND" | "BUDGET_EXCLUDES_FEE"
  | "PRODUCER_REQUIRED_UNSUPPORTED" | "PRODUCER_NOT_PRIOR_TRADE" | "PRODUCER_NOT_FOUND";

export const RESOLVE_NOTICE_TEXT: Record<ResolveNotice, string> = {
  ITEM_NOT_FOUND: "品目が登録データに見つかりませんでした。一覧から選んでください",
  ITEM_AMBIGUOUS: "品目の候補が複数あります。選んでください",
  VARIETY_NOT_FOUND: "品種が登録データに見つかりませんでした。品種を選ぶか「指定なし」にしてください",
  DATE_AMBIGUOUS: "受け取りたい日の候補が複数あります。日付を確認してください",
  DATE_NOT_UNDERSTOOD: "受け取りたい日を特定できませんでした。日付を入力してください",
  DATE_WEEKDAY_MISMATCH: "日付と曜日が合いません。日付を確認してください",
  ORIGIN_AMBIGUOUS: "産地の範囲があいまいです（例：「近郊」）。対象の府県を選んでください",
  ORIGIN_NOT_FOUND: "産地を特定できませんでした。都道府県を選んでください",
  HANDOVER_AMBIGUOUS: "受取場所に合う受渡枠が複数あります。選んでください",
  HANDOVER_NOT_FOUND: "受取場所に合う受渡枠が見つかりませんでした。一覧から選んでください",
  BUDGET_EXCLUDES_FEE: "予算は「受渡費込みの総額」で判定します。金額を確認してください",
  PRODUCER_REQUIRED_UNSUPPORTED: "農家の必須指定は今回の対応範囲外です。「優先」として扱うかを選んでください",
  PRODUCER_NOT_PRIOR_TRADE: "優先指定は取引経験のある農家だけに対応しています",
  PRODUCER_NOT_FOUND: "優先したい農家が登録データに見つかりませんでした",
};

export type Resolution = {
  draft: Draft;
  /** 利用者の確認・選択が必要な項目 */
  unresolvedFields: DraftField[];
  candidateMatches: Partial<Record<"itemId" | "varietyId" | "desiredDate" | "originPrefectures" | "slotId" | "preferredProducerId", Candidate[]>>;
  notices: ResolveNotice[];
};

/** 照合用に正規化（全角→半角・空白除去・小文字） */
export const normalize = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

/** 名前の照合用：カタカナをひらがなにそろえる（「ナス」と「なす」、「とまと」と「トマト」を同じ名前として扱う） */
export const kanaFold = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const nameKey = (s: string) => kanaFold(normalize(s));

/** 完全一致を優先し、なければ部分一致（どちらか一方が他方を含む）。カタカナ・ひらがなの違いは同じとみなす */
function matchByName<T extends { name: string }>(text: string, list: T[]): { exact: T | null; partial: T[] } {
  const t = nameKey(text);
  const exact = list.find((x) => nameKey(x.name) === t) ?? null;
  const partial = exact ? [] : list.filter((x) => nameKey(x.name).includes(t) || t.includes(nameKey(x.name)));
  return { exact, partial };
}

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

const WEEKDAYS = "日月火水木金土";

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * 日付の表現から、基準日時（JST）での候補日（YYYY-MM-DD）を出す。AI に今日の日付を推測させない。
 * 例:「10月23日」「10/23」「2026-10-23」「明日」「明後日」「金曜」「今週金曜」「来週の金曜」
 */
export function dateCandidates(dateText: string, now: Date): { dates: string[]; weekdayMismatch: boolean } {
  const t = normalize(dateText);
  const today = jstDate(0, now);
  const year = Number(today.slice(0, 4));
  const wdMatch = t.match(/([日月火水木金土])曜/);
  const wd = wdMatch ? WEEKDAYS.indexOf(wdMatch[1]) : null;

  const iso = t.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  const md = iso ? null : t.match(/(\d{1,2})(?:月|\/)(\d{1,2})日?/);
  if (iso || md) {
    const [y, m, d] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [year, Number(md![1]), Number(md![2])];
    let date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).getUTCDate() !== d) return { dates: [], weekdayMismatch: false };
    // 年が書かれておらず、今年のその日がもう過ぎていれば来年
    if (!iso && date < today) date = `${y + 1}${date.slice(4)}`;
    return { dates: [date], weekdayMismatch: wd !== null && weekdayOf(date) !== wd };
  }
  if (/明後日|あさって/.test(t)) return { dates: [addDays(today, 2)], weekdayMismatch: false };
  if (/明日|あした/.test(t)) return { dates: [addDays(today, 1)], weekdayMismatch: false };
  if (/今日|本日|きょう/.test(t)) return { dates: [today], weekdayMismatch: false };

  if (wd !== null) {
    const diff = (wd - weekdayOf(today) + 7) % 7; // 今日以降で最初のその曜日
    const next = addDays(today, diff);
    if (/来週/.test(t)) {
      // 来週（月曜始まり）のその曜日
      const mondayNextWeek = addDays(today, ((8 - weekdayOf(today)) % 7) || 7);
      return { dates: [addDays(mondayNextWeek, (wd + 6) % 7)], weekdayMismatch: false };
    }
    // 「金曜」が今日を指すか翌週かが曖昧なとき（今日がその曜日）は両方を候補にする
    if (diff === 0 && !/今日|本日/.test(t)) return { dates: [today, addDays(today, 7)], weekdayMismatch: false };
    return { dates: [next], weekdayMismatch: false };
  }
  return { dates: [], weekdayMismatch: false };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export function resolveExtraction(x: ExtractedRequest, catalog: Catalog, now: Date): Resolution {
  const notices: ResolveNotice[] = [];
  const candidateMatches: Resolution["candidateMatches"] = {};
  const draft: Draft = {
    itemId: null, varietyId: null, quantityKg: x.quantityKg, desiredDate: null, budget: null, originPrefectures: [], slotId: null,
    allowFirstTime: x.allowFirstTime, allowIrregular: x.allowIrregular, allowMixedVarieties: x.allowMixedVarieties,
    allowMixedGrades: x.allowMixedGrades, preferredProducerId: null,
  };

  // 品目 → 登録済みの Item
  if (x.itemText) {
    const { exact, partial } = matchByName(x.itemText, catalog.items);
    if (exact) draft.itemId = exact.id;
    else if (partial.length > 0) {
      candidateMatches.itemId = partial.map((i) => ({ id: i.id, label: i.name }));
      notices.push("ITEM_AMBIGUOUS");
    } else notices.push("ITEM_NOT_FOUND");
  }

  // 品種 → その品目の登録済み Variety（指定がなければ「指定なし」のまま）
  const item = catalog.items.find((i) => i.id === draft.itemId);
  if (x.varietyText && item) {
    const { exact, partial } = matchByName(x.varietyText, item.varieties);
    if (exact) draft.varietyId = exact.id;
    else {
      if (partial.length > 0) candidateMatches.varietyId = partial.map((v) => ({ id: v.id, label: v.name }));
      notices.push("VARIETY_NOT_FOUND");
    }
  }

  // 日付 → 基準日時で候補日
  if (x.dateText) {
    const { dates, weekdayMismatch } = dateCandidates(x.dateText, now);
    if (weekdayMismatch) notices.push("DATE_WEEKDAY_MISMATCH");
    if (dates.length === 1 && !weekdayMismatch) draft.desiredDate = dates[0];
    else if (dates.length > 1) notices.push("DATE_AMBIGUOUS");
    else if (dates.length === 0) notices.push("DATE_NOT_UNDERSTOOD");
    if (dates.length > 0) candidateMatches.desiredDate = dates.map((d) => ({ id: d, label: formatDateJa(d) }));
  }

  // 予算（受渡費込みの総額で判定する。商品代のみと書かれていれば金額を確認させる）
  if (x.budgetYen !== null) {
    if (x.budgetIncludesHandoverFee === false) notices.push("BUDGET_EXCLUDES_FEE");
    else draft.budget = { mode: "limit", yen: x.budgetYen };
  } else if (x.budgetUnlimited === true) draft.budget = { mode: "none" };

  // 産地（どこで採れたか）→ 都道府県。受取場所とは混同しない
  if (x.originText) {
    const t = normalize(x.originText).replace(/産|の|県産|府産/g, "");
    if (/近郊|周辺|近辺|関西|近畿|あたり|付近/.test(t)) notices.push("ORIGIN_AMBIGUOUS");
    else {
      const parts = t.split(/[・、,/と や]|か/).filter(Boolean);
      const found = parts.map((p) => catalog.prefectures.find((pref) => normalize(pref) === p || normalize(pref).replace(/[都道府県]$/, "") === p));
      if (parts.length > 0 && found.every(Boolean)) draft.originPrefectures = [...new Set(found as string[])];
      else notices.push("ORIGIN_NOT_FOUND");
    }
  }

  // 受取場所・受渡枠 → 登録済みの HandoverSlot（場所の文字列で照合し、日付が決まっていればその日の枠に絞る）
  const slotsOnDate = catalog.slots.filter((s) => !draft.desiredDate || jstDate(0, new Date(s.startAt)) === draft.desiredDate);
  if (x.handoverText) {
    const t = normalize(x.handoverText).replace(/で受け?取り?(たい)?|受取|受け取り|で$/g, "");
    const hits = slotsOnDate.filter((s) =>
      [s.label, s.placeName, s.placeAddress].some((v) => normalize(v).includes(t) || (t.length >= 2 && t.includes(normalize(v)))));
    if (hits.length === 1) draft.slotId = hits[0].id;
    else if (hits.length > 1) {
      candidateMatches.slotId = hits.map((s) => ({ id: s.id, label: s.label }));
      notices.push("HANDOVER_AMBIGUOUS");
    } else notices.push("HANDOVER_NOT_FOUND");
  }
  if (!draft.slotId && !candidateMatches.slotId && slotsOnDate.length > 0)
    candidateMatches.slotId = slotsOnDate.map((s) => ({ id: s.id, label: s.label })); // 候補として示すだけ（自動選択しない）

  // 優先農家 → 登録済み Producer。取引経験のある農家だけ優先指定に使う。必須指定は弱めずに確認させる
  if (x.preferredProducerText) {
    const { exact, partial } = matchByName(x.preferredProducerText, catalog.producers);
    const hits = exact ? [exact] : partial;
    const prior = hits.filter((p) => catalog.priorTradeProducers.some((q) => q.id === p.id));
    if (hits.length === 0) notices.push("PRODUCER_NOT_FOUND");
    else if (prior.length === 0) notices.push("PRODUCER_NOT_PRIOR_TRADE");
    else if (x.producerRequired === true) {
      notices.push("PRODUCER_REQUIRED_UNSUPPORTED");
      candidateMatches.preferredProducerId = prior.map((p) => ({ id: p.id, label: p.name }));
    } else if (prior.length === 1) draft.preferredProducerId = prior[0].id;
    else candidateMatches.preferredProducerId = prior.map((p) => ({ id: p.id, label: p.name }));
  }

  const unresolvedFields: DraftField[] = [];
  if (!draft.itemId) unresolvedFields.push("itemId");
  if (x.varietyText && !draft.varietyId) unresolvedFields.push("varietyId");
  if (draft.quantityKg === null) unresolvedFields.push("quantityKg");
  if (!draft.desiredDate) unresolvedFields.push("desiredDate");
  if (!draft.budget) unresolvedFields.push("budget");
  if (draft.originPrefectures.length === 0) unresolvedFields.push("originPrefectures");
  if (!draft.slotId) unresolvedFields.push("slotId");
  for (const k of ["allowFirstTime", "allowIrregular", "allowMixedVarieties", "allowMixedGrades"] as const)
    if (draft[k] === null) unresolvedFields.push(k);
  if (x.preferredProducerText && !draft.preferredProducerId) unresolvedFields.push("preferredProducerId");

  return { draft, unresolvedFields, candidateMatches, notices: [...new Set(notices)] };
}
