import { jstDateOf } from "./dates.js";

// 仕入れ案の通常ロジック（仕様書 9.3〜9.4）。AI は使わない。
// 純粋関数のみ：DB アクセス・現在時刻の取得はしない（呼び出し側が now と最新データを渡す）。
// 案を作っても供給の数量は変えない（提案は在庫予約ではない）。

/** 1案に組み合わせる農家数の上限 */
export const MAX_PRODUCERS = 3;
/** 1回の計算で扱う対象供給の上限。超えたら先頭だけで計算せず、条件を絞るよう返す */
export const MAX_CANDIDATE_SUPPLIES = 20;
export const QUANTITY_KG_MIN = 1;
export const QUANTITY_KG_MAX = 100;

export type Grade = "regular" | "irregular";

/** 利用者が確定した条件。産地（originPrefectures）と受取場所（slotId）は別の条件 */
export type PlanRequest = {
  itemId: string;
  varietyId: string | null; // null＝品種指定なし（それでも混在許可がなければ同じ品種どうしで組む）
  quantityKg: number; // 整数kg、1〜100
  desiredDate: string; // 受け取りたい日（日本時間 YYYY-MM-DD）
  budgetYen: number | null; // 税込・受渡費込みの上限。null＝上限なし
  originPrefectures: string[]; // 産地条件（例: 大阪府）
  slotId: string; // 受渡枠（場所・日時の条件）
  allowIrregular: boolean;
  allowMixedVarieties: boolean;
  allowMixedGrades: boolean;
  allowFirstTime: boolean;
  preferredProducerId: string | null; // 優先したい取引済み農家
};

export type PlanSupply = {
  id: string;
  producerId: string;
  producerName: string;
  itemId: string;
  varietyId: string;
  varietyName: string;
  grade: Grade;
  irregularReason: string | null;
  originPrefecture: string;
  availableKg: number;
  priceYenPerKg: number;
  minKg: number;
  slotId: string;
  published: boolean;
  version: number;
  updatedAt: string; // ISO
};

export type PlanSlot = {
  id: string;
  label: string;
  placeName: string;
  startAt: string; // ISO
  endAt: string;
  confirmDeadlineAt: string;
  feeYen: number; // 1案につき1回だけ加算する税込固定費
  feeConfirmed: boolean;
  maxKg: number;
  conditionsConfirmed: boolean;
};

export type PlanParticipant = { slotId: string; producerId: string; confirmed: boolean };
/** 店の申告による取引経験（この店の分だけ渡す）。無い農家は初回扱い */
export type PlanRelationship = { producerId: string; priorTrade: boolean };

export type PlanStatus = "MATCHED" | "NEEDS_CONFIRMATION" | "NOT_MATCHED";

export type ReasonCode =
  // 仕様書 9.4
  | "INSUFFICIENT_QUANTITY"
  | "OVER_BUDGET"
  | "LOT_CONSTRAINT"
  | "HANDOVER_MISMATCH"
  | "DEADLINE_PASSED"
  | "SEARCH_SCOPE_LIMIT"
  | "FIRST_TIME_EXCLUDED"
  | "PRODUCT_MISMATCH"
  // 内部コード（表示文は reasons.ts）
  | "FEE_UNCONFIRMED" // 受渡費が未確認（総額未確定）
  | "SLOT_CONDITIONS_UNCONFIRMED" // 受渡枠の条件が未確認
  | "PARTICIPATION_UNCONFIRMED" // 生産者の受渡枠への参加が未確認
  | "SLOT_WEIGHT_LIMIT" // 枠の重量上限が希望量より小さい
  | "TOO_MANY_SUPPLIES" // 対象供給が多すぎて計算しない
  | "MIXING_NOT_ALLOWED" // 品種・規格の混在を許可していないため合算しない
  | "UNAVAILABLE"; // 公開停止・在庫0

/** 供給ごとの除外理由（詳細）。どれも「既知の不一致」で、確認待ちとして救済しない */
export type ExclusionDetail =
  | "NOT_PUBLISHED"
  | "NO_STOCK"
  | "ITEM_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "VARIETY_MISMATCH"
  | "IRREGULAR_NOT_ALLOWED"
  | "OTHER_SLOT"
  | "SLOT_NOT_FOUND"
  | "SLOT_DATE_MISMATCH"
  | "NOT_SLOT_PARTICIPANT" // 枠の参加者として登録されていない（未確認ではなく不一致）
  | "DEADLINE_PASSED"
  | "FIRST_TIME"
  | "MIN_EXCEEDS_STOCK"
  | "MIN_EXCEEDS_REQUEST"
  | "MIN_EXCEEDS_SLOT_LIMIT";

export const DETAIL_CATEGORY: Record<ExclusionDetail, ReasonCode> = {
  NOT_PUBLISHED: "UNAVAILABLE",
  NO_STOCK: "UNAVAILABLE",
  ITEM_MISMATCH: "PRODUCT_MISMATCH",
  ORIGIN_MISMATCH: "PRODUCT_MISMATCH",
  VARIETY_MISMATCH: "PRODUCT_MISMATCH",
  IRREGULAR_NOT_ALLOWED: "PRODUCT_MISMATCH",
  OTHER_SLOT: "HANDOVER_MISMATCH",
  SLOT_NOT_FOUND: "HANDOVER_MISMATCH",
  SLOT_DATE_MISMATCH: "HANDOVER_MISMATCH",
  NOT_SLOT_PARTICIPANT: "HANDOVER_MISMATCH",
  DEADLINE_PASSED: "DEADLINE_PASSED",
  FIRST_TIME: "FIRST_TIME_EXCLUDED",
  MIN_EXCEEDS_STOCK: "LOT_CONSTRAINT",
  MIN_EXCEEDS_REQUEST: "LOT_CONSTRAINT",
  MIN_EXCEEDS_SLOT_LIMIT: "LOT_CONSTRAINT",
};

export type Exclusion = {
  supplyId: string;
  producerId: string;
  producerName: string;
  availableKg: number;
  priceYenPerKg: number;
  details: ExclusionDetail[];
  reasonCodes: ReasonCode[];
};

export type PlanAllocation = {
  supplyId: string;
  producerId: string;
  producerName: string;
  priorTrade: boolean; // 取引経験あり（店の申告）。false は初回
  preferred: boolean;
  varietyName: string;
  grade: Grade;
  irregularReason: string | null;
  participationConfirmed: boolean; // false なら受渡枠への参加確認が必要
  kg: number;
  priceYenPerKg: number;
  subtotalYen: number;
  version: number;
  updatedAt: string;
};

export type RankingReasonCode =
  | "SINGLE_PRODUCER" // 1農家で揃うので分割しない
  | "FEWER_PRODUCERS" // 取引済み農家を含む案より、仕入れ先の数が少ない案を優先した
  | "PRIOR_TRADE_FIRST" // 最安ではないが、取引済み農家からの数量を優先した
  | "SUPPLEMENTED"; // 1農家では揃わないので補完した

export type RankingReason = { code: RankingReasonCode; producerNames: string[]; producerCount: number };

export type NoticeCode = "PREFERRED_NOT_PRIOR_TRADE" | "PREFERRED_NOT_AVAILABLE";

export type BudgetStatus = "NO_LIMIT" | "WITHIN" | "UNKNOWN";

export type PlanResult = {
  status: PlanStatus;
  reasonCodes: ReasonCode[]; // MATCHED のときは空
  allocations: PlanAllocation[];
  requestedKg: number;
  fulfilledKg: number;
  shortageKg: number;
  producerCount: number;
  productSubtotalYen: number;
  handoverFeeYen: number | null; // 費用未確認なら null
  totalYen: number | null; // 総額。費用未確認なら null（予算内とは判定しない）
  budgetYen: number | null;
  budgetStatus: BudgetStatus;
  /** 予算を外せば希望量ちょうどにできる場合の、その案の数量・総額（OVER_BUDGET の説明用） */
  overBudget: { kg: number; totalYen: number | null } | null;
  rankingReason: RankingReason | null;
  excluded: Exclusion[];
  /** 既知の不一致は無いが、受渡枠への参加が未確認の供給（確認が必要） */
  unconfirmedParticipants: { supplyId: string; producerId: string; producerName: string; availableKg: number }[];
  notices: NoticeCode[];
  slot: Pick<PlanSlot, "id" | "label" | "placeName" | "startAt" | "endAt" | "confirmDeadlineAt"> | null;
  /** 計算に使った供給の version（表示中の案が古いかの判定・説明用） */
  supplySnapshot: { supplyId: string; version: number; updatedAt: string }[];
  computedAt: string;
};

export type AllocateInput = {
  request: PlanRequest;
  supplies: PlanSupply[];
  slot: PlanSlot | null;
  participants: PlanParticipant[];
  relationships: PlanRelationship[];
  now: Date;
};

// ---------------------------------------------------------------------------
// 探索
// ---------------------------------------------------------------------------

type Cand = { s: PlanSupply; prior: boolean; preferred: boolean; unconfirmed: boolean };
type Option = {
  picks: { c: Cand; kg: number }[];
  kg: number;
  producers: number;
  preferredKg: number;
  priorKg: number;
  subtotal: number;
  ids: string[]; // 供給 ID（昇順）
};

const isIrregular = (s: PlanSupply) => s.grade === "irregular" || !!s.irregularReason;

/** 同じ数量・同じ農家数の案どうしの順位（仕様 9.3-6 の①〜④）。負なら a が上位 */
function rank(a: Option, b: Option): number {
  if (a.preferredKg !== b.preferredKg) return b.preferredKg - a.preferredKg;
  if (a.priorKg !== b.priorKg) return b.priorKg - a.priorKg;
  if (a.subtotal !== b.subtotal) return a.subtotal - b.subtotal; // 固定費は同じ枠で共通なので商品代で比べる
  for (let i = 0; i < Math.min(a.ids.length, b.ids.length); i++)
    if (a.ids[i] !== b.ids[i]) return a.ids[i] < b.ids[i] ? -1 : 1;
  return a.ids.length - b.ids.length;
}
const byCost = (a: Option, b: Option) => a.subtotal - b.subtotal || rank(a, b);

function makeOption(picks: { c: Cand; kg: number }[]): Option {
  let preferredKg = 0, priorKg = 0, subtotal = 0, kg = 0;
  for (const { c, kg: q } of picks) {
    kg += q;
    subtotal += q * c.s.priceYenPerKg;
    if (c.prior) priorKg += q;
    if (c.preferred) preferredKg += q;
  }
  return {
    picks, kg, subtotal, priorKg, preferredKg,
    producers: new Set(picks.map((p) => p.c.s.producerId)).size,
    ids: picks.map((p) => p.c.s.id).sort(),
  };
}

/** 供給ごとに 0 か「minKg 以上・在庫以下」の整数 kg を割り当てて、合計 target ちょうどになる配分を列挙する */
function* splits(subset: Cand[], target: number): Generator<number[]> {
  const lo = subset.map((c) => c.s.minKg);
  const hi = subset.map((c) => Math.min(c.s.availableKg, target));
  const rec = function* (i: number, rest: number, acc: number[]): Generator<number[]> {
    if (i === subset.length - 1) {
      if (rest >= lo[i] && rest <= hi[i]) yield [...acc, rest];
      return;
    }
    // 残りの供給で作れる範囲に入るものだけ試す（1kg刻みなので作れる合計は連続区間）
    let restLo = 0, restHi = 0;
    for (let j = i + 1; j < subset.length; j++) { restLo += lo[j]; restHi += hi[j]; }
    for (let q = Math.max(lo[i], rest - restHi); q <= Math.min(hi[i], rest - restLo); q++) yield* rec(i + 1, rest - q, [...acc, q]);
  };
  yield* rec(0, target, []);
}

/** 異なる農家の供給 k 件の組合せ（ID 順） */
function* subsetsOf(cands: Cand[], k: number, start = 0, acc: Cand[] = []): Generator<Cand[]> {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i < cands.length; i++) {
    if (acc.some((a) => a.s.producerId === cands[i].s.producerId)) continue;
    yield* subsetsOf(cands, k, i + 1, [...acc, cands[i]]);
  }
}

/**
 * 1つのグループ（同じ枠・混在条件を満たす供給）で、ちょうど target kg・k 農家の最良案。
 * subtotalLimit は商品代の上限（予算 − 固定費）。null なら上限なし。
 */
function bestAt(cands: Cand[], target: number, k: number, subtotalLimit: number | null, cmp = rank): Option | null {
  let best: Option | null = null;
  for (const subset of subsetsOf(cands, k)) {
    const minSum = subset.reduce((s, c) => s + c.s.minKg, 0);
    const maxSum = subset.reduce((s, c) => s + Math.min(c.s.availableKg, target), 0);
    if (target < minSum || target > maxSum) continue;
    for (const kgs of splits(subset, target)) {
      const opt = makeOption(subset.map((c, i) => ({ c, kg: kgs[i] })));
      if (subtotalLimit !== null && opt.subtotal > subtotalLimit) continue;
      if (!best || cmp(opt, best) < 0) best = opt;
    }
  }
  return best;
}

/** 全グループの中で、ちょうど target kg を最少の農家数で作る最良案 */
function bestExact(groups: Cand[][], target: number, subtotalLimit: number | null): { opt: Option; k: number } | null {
  for (let k = 1; k <= MAX_PRODUCERS; k++) {
    let best: Option | null = null;
    for (const g of groups) {
      const o = bestAt(g, target, k, subtotalLimit);
      if (o && (!best || rank(o, best) < 0)) best = o;
    }
    if (best) return { opt: best, k };
  }
  return null;
}

/** 農家数の制限なしで、ちょうど target kg を作れるか（SEARCH_SCOPE_LIMIT の判定用） */
function reachableWithoutLimit(cands: Cand[], target: number): boolean {
  let reach = new Array<boolean>(target + 1).fill(false);
  reach[0] = true;
  for (const c of cands) {
    const next = [...reach];
    for (let t = 0; t <= target; t++) {
      if (!reach[t]) continue;
      for (let q = c.s.minKg; q <= Math.min(c.s.availableKg, target - t); q++) next[t + q] = true;
    }
    reach = next;
  }
  return reach[target];
}

function rankingReasonFor(groups: Cand[][], chosen: Option, k: number, target: number, subtotalLimit: number | null): RankingReason {
  const names = [...new Set(chosen.picks.map((p) => p.c.s.producerName))];
  const base = { producerNames: names, producerCount: k };
  // より多い農家数なら、取引済み農家からの数量を増やせたか
  for (let more = k + 1; more <= MAX_PRODUCERS; more++)
    for (const g of groups) {
      const o = bestAt(g, target, more, subtotalLimit);
      if (o && o.priorKg > chosen.priorKg) return { code: "FEWER_PRODUCERS", ...base };
    }
  // 同じ農家数で、より安い案があったか（安さより取引済み農家を優先した）
  for (const g of groups) {
    const o = bestAt(g, target, k, subtotalLimit, byCost);
    if (o && o.subtotal < chosen.subtotal) return { code: "PRIOR_TRADE_FIRST", ...base };
  }
  return { code: k === 1 ? "SINGLE_PRODUCER" : "SUPPLEMENTED", ...base };
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export function allocatePlan({ request: req, supplies, slot, participants, relationships, now }: AllocateInput): PlanResult {
  const priorOf = new Map(relationships.map((r) => [r.producerId, r.priorTrade]));
  const isPrior = (producerId: string) => priorOf.get(producerId) === true;
  const notices: NoticeCode[] = [];
  // 指名優先は取引済み農家だけ（9.3-7）。初回農家の指名は「取引経験あり」と扱わない
  let preferredId = req.preferredProducerId;
  if (preferredId && !isPrior(preferredId)) {
    notices.push("PREFERRED_NOT_PRIOR_TRADE");
    preferredId = null;
  }

  // 枠そのものの判定（場所・日付・締切）。合わなければ枠内の供給はすべて既知の不一致
  const slotIssue: ExclusionDetail | null = !slot || slot.id !== req.slotId
    ? "SLOT_NOT_FOUND"
    : jstDateOf(slot.startAt) !== req.desiredDate || jstDateOf(slot.endAt) !== req.desiredDate
      ? "SLOT_DATE_MISMATCH"
      : now.getTime() > new Date(slot.confirmDeadlineAt).getTime()
        ? "DEADLINE_PASSED"
        : null;
  // 枠の参加者として登録済みか、その参加が確認済みか。未登録は既知の不一致、登録済み・未確認は「確認が必要」
  const participation = new Map(participants.filter((p) => p.slotId === req.slotId).map((p) => [p.producerId, p.confirmed]));
  const maxKg = slot?.maxKg ?? 0;

  const excluded: Exclusion[] = [];
  const eligible: Cand[] = [];
  for (const s of [...supplies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const d: ExclusionDetail[] = [];
    if (!s.published) d.push("NOT_PUBLISHED");
    if (s.itemId !== req.itemId) d.push("ITEM_MISMATCH");
    if (!req.originPrefectures.includes(s.originPrefecture)) d.push("ORIGIN_MISMATCH");
    if (req.varietyId !== null && s.varietyId !== req.varietyId && !req.allowMixedVarieties) d.push("VARIETY_MISMATCH");
    if (isIrregular(s) && !req.allowIrregular) d.push("IRREGULAR_NOT_ALLOWED");
    if (s.slotId !== req.slotId) d.push("OTHER_SLOT");
    else {
      if (slotIssue) d.push(slotIssue);
      if (!participation.has(s.producerId)) d.push("NOT_SLOT_PARTICIPANT");
    }
    if (!isPrior(s.producerId) && !req.allowFirstTime) d.push("FIRST_TIME");
    if (s.availableKg <= 0) d.push("NO_STOCK");
    else if (s.minKg > s.availableKg) d.push("MIN_EXCEEDS_STOCK");
    else if (s.minKg > req.quantityKg) d.push("MIN_EXCEEDS_REQUEST");
    else if (slot && s.minKg > slot.maxKg) d.push("MIN_EXCEEDS_SLOT_LIMIT");

    if (d.length > 0)
      excluded.push({
        supplyId: s.id, producerId: s.producerId, producerName: s.producerName, availableKg: s.availableKg,
        priceYenPerKg: s.priceYenPerKg, details: d, reasonCodes: [...new Set(d.map((x) => DETAIL_CATEGORY[x]))],
      });
    // 既知の不一致が1つでもあれば上で除外済み。参加未確認だけの供給は候補に残し、確認待ちとして扱う
    else eligible.push({ s, prior: isPrior(s.producerId), preferred: s.producerId === preferredId, unconfirmed: participation.get(s.producerId) !== true });
  }
  if (req.preferredProducerId && preferredId && !eligible.some((c) => c.preferred)) notices.push("PREFERRED_NOT_AVAILABLE");

  const feeKnown = !!slot && slot.feeConfirmed;
  const confirmCodes: ReasonCode[] = slot && !slotIssue
    ? [...(slot.feeConfirmed ? [] : ["FEE_UNCONFIRMED" as const]), ...(slot.conditionsConfirmed ? [] : ["SLOT_CONDITIONS_UNCONFIRMED" as const])]
    : [];
  // 予算判定に使う固定費。未確認なら下限 0 円とみなし「確実に超える」案だけを外す（予算内とは判定しない）
  const feeForBudget = feeKnown ? slot!.feeYen : 0;
  const subtotalLimit = req.budgetYen === null ? null : req.budgetYen - feeForBudget;

  // 枠内の除外理由（別枠の供給は原因に数えない）
  const inSlotExclusionCodes = excluded
    .filter((e) => !e.details.includes("OTHER_SLOT"))
    .flatMap((e) => e.reasonCodes)
    .filter((c) => c !== "UNAVAILABLE");

  const result = (o: Partial<PlanResult> & Pick<PlanResult, "status" | "reasonCodes">): PlanResult => ({
    allocations: [], requestedKg: req.quantityKg, fulfilledKg: 0, shortageKg: req.quantityKg, producerCount: 0,
    productSubtotalYen: 0, handoverFeeYen: feeKnown ? 0 : null, totalYen: feeKnown ? 0 : null, budgetYen: req.budgetYen,
    budgetStatus: req.budgetYen === null ? "NO_LIMIT" : "UNKNOWN", overBudget: null, rankingReason: null, excluded, notices,
    unconfirmedParticipants: eligible.filter((c) => c.unconfirmed)
      .map((c) => ({ supplyId: c.s.id, producerId: c.s.producerId, producerName: c.s.producerName, availableKg: c.s.availableKg })),
    slot: slot ? { id: slot.id, label: slot.label, placeName: slot.placeName, startAt: slot.startAt, endAt: slot.endAt, confirmDeadlineAt: slot.confirmDeadlineAt } : null,
    supplySnapshot: supplies.map((s) => ({ supplyId: s.id, version: s.version, updatedAt: s.updatedAt })),
    computedAt: now.toISOString(),
    ...o,
  });
  const unique = (codes: ReasonCode[]) => [...new Set(codes)];

  if (slotIssue)
    return result({ status: "NOT_MATCHED", reasonCodes: unique([DETAIL_CATEGORY[slotIssue], ...inSlotExclusionCodes]) });
  if (eligible.length > MAX_CANDIDATE_SUPPLIES)
    return result({ status: "NOT_MATCHED", reasonCodes: ["TOO_MANY_SUPPLIES"] });

  // 品種・規格の混在を許可しない場合は、同じ品種・規格どうしのグループ内だけで組む
  const groupsOf = (cands: Cand[]) => {
    const groupMap = new Map<string, Cand[]>();
    for (const c of cands) {
      const key = `${req.allowMixedVarieties ? "*" : c.s.varietyId}|${req.allowMixedGrades ? "*" : isIrregular(c.s) ? "irregular" : "regular"}`;
      groupMap.set(key, [...(groupMap.get(key) ?? []), c]);
    }
    return [...groupMap.values()];
  };
  // 適合判定・不足時の最大量は確認済みの供給だけで計算する。参加未確認を含めた案は「確認が必要」の参考案
  const confirmedEligible = eligible.filter((c) => !c.unconfirmed);
  const groups = groupsOf(confirmedEligible);
  const groupsWithUnconfirmed = groupsOf(eligible);

  const toResult = (opt: Option, k: number, target: number, status: PlanStatus, reasonCodes: ReasonCode[], extra: Partial<PlanResult> = {}, searched = groups): PlanResult => {
    const allocations: PlanAllocation[] = opt.picks
      .map(({ c, kg }) => ({
        supplyId: c.s.id, producerId: c.s.producerId, producerName: c.s.producerName, priorTrade: c.prior, preferred: c.preferred,
        varietyName: c.s.varietyName, grade: isIrregular(c.s) ? ("irregular" as const) : ("regular" as const), irregularReason: c.s.irregularReason,
        participationConfirmed: !c.unconfirmed, kg, priceYenPerKg: c.s.priceYenPerKg, subtotalYen: kg * c.s.priceYenPerKg, version: c.s.version, updatedAt: c.s.updatedAt,
      }))
      .sort((a, b) => b.kg - a.kg || Number(b.priorTrade) - Number(a.priorTrade) || (a.supplyId < b.supplyId ? -1 : 1));
    const fee = feeKnown ? slot!.feeYen : null; // 固定費は農家数にかかわらず1案に1回
    return result({
      status, reasonCodes, allocations, fulfilledKg: opt.kg, shortageKg: req.quantityKg - opt.kg, producerCount: opt.producers,
      productSubtotalYen: opt.subtotal, handoverFeeYen: fee, totalYen: fee === null ? null : opt.subtotal + fee,
      budgetStatus: req.budgetYen === null ? "NO_LIMIT" : fee === null ? "UNKNOWN" : "WITHIN",
      rankingReason: rankingReasonFor(searched, opt, k, target, subtotalLimit),
      ...extra,
    });
  };

  // 1. 希望量ちょうど（予算内）を 1→2→3 農家の順に探す
  const target = req.quantityKg;
  const exact = target <= maxKg ? bestExact(groups, target, subtotalLimit) : null;
  if (exact) {
    const status: PlanStatus = confirmCodes.length > 0 ? "NEEDS_CONFIRMATION" : "MATCHED";
    return toResult(exact.opt, exact.k, target, status, confirmCodes);
  }
  // 確認済みの供給では揃わないが、参加未確認の供給も含めれば揃う → 参考案として「確認が必要」
  const pending = target <= maxKg && confirmedEligible.length < eligible.length ? bestExact(groupsWithUnconfirmed, target, subtotalLimit) : null;
  if (pending)
    return toResult(pending.opt, pending.k, target, "NEEDS_CONFIRMATION", unique(["PARTICIPATION_UNCONFIRMED", ...confirmCodes]), {}, groupsWithUnconfirmed);

  // 2. ちょうどにできない原因（数量不足と予算不足を区別する）
  const reasons: ReasonCode[] = [];
  let overBudget: PlanResult["overBudget"] = null;
  const exactIgnoringBudget = subtotalLimit !== null && target <= maxKg ? bestExact(groups, target, null) : null;
  if (target > maxKg) reasons.push("SLOT_WEIGHT_LIMIT");
  else if (exactIgnoringBudget) {
    reasons.push("OVER_BUDGET");
    overBudget = { kg: target, totalYen: feeKnown ? exactIgnoringBudget.opt.subtotal + slot!.feeYen : null };
  } else if (groups.some((g) => reachableWithoutLimit(g, target))) reasons.push("SEARCH_SCOPE_LIMIT");
  else if (groups.some((g) => g.reduce((s, c) => s + c.s.availableKg, 0) >= target)) reasons.push("LOT_CONSTRAINT");
  else reasons.push("INSUFFICIENT_QUANTITY");
  const mixingRestricted = !req.allowMixedVarieties || !req.allowMixedGrades;
  if (mixingRestricted && groups.length > 1 && confirmedEligible.reduce((s, c) => s + c.s.availableKg, 0) >= target) reasons.push("MIXING_NOT_ALLOWED");
  const pendingCodes: ReasonCode[] = confirmedEligible.length < eligible.length ? ["PARTICIPATION_UNCONFIRMED"] : [];
  const reasonCodes = unique([...reasons, ...inSlotExclusionCodes, ...confirmCodes, ...pendingCodes]);

  // 3. 確認済み条件・予算内で、希望量以下の最大量（過剰購入はしない）
  for (let t = Math.min(target - 1, maxKg); t >= 1; t--) {
    const best = bestExact(groups, t, subtotalLimit);
    if (best) return toResult(best.opt, best.k, t, "NOT_MATCHED", reasonCodes, { overBudget });
  }
  return result({ status: "NOT_MATCHED", reasonCodes, overBudget });
}
