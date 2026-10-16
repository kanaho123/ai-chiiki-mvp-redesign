import { describe, expect, it } from "vitest";
import {
  allocatePlan, MAX_CANDIDATE_SUPPLIES, type AllocateInput, type PlanRequest, type PlanResult, type PlanSlot, type PlanSupply,
} from "./allocate.js";
import { headlineText, rankingText, REASON_TEXT } from "./reasons.js";

// 仕様書 8.1 のデモ設定（架空）。基準日時 2026-10-22 12:00 JST
const NOW = new Date("2026-10-22T12:00:00+09:00");

const slotP: PlanSlot = {
  id: "gp", label: "G-P", placeName: "受渡拠点P", startAt: "2026-10-23T10:00:00+09:00", endAt: "2026-10-23T11:00:00+09:00",
  confirmDeadlineAt: "2026-10-22T17:00:00+09:00", feeYen: 800, feeConfirmed: true, maxKg: 20, conditionsConfirmed: true,
};

const NAMES: Record<string, string> = { a: "A農園", b: "B農園", c: "C農園", d: "D農園", e: "E農園", f: "F農園" };
const PRICES: Record<string, number> = { a: 600, b: 550, c: 500, d: 300, e: 520, f: 510 };

const supply = (key: string, availableKg: number, o: Partial<PlanSupply> = {}): PlanSupply => ({
  id: `s-${key}`, producerId: `p-${key}`, producerName: NAMES[key] ?? `${key}農園`, itemId: "tomato", varietyId: "v1", varietyName: "品種T",
  grade: "regular", irregularReason: null, originPrefecture: "大阪府", availableKg, priceYenPerKg: PRICES[key] ?? 500, minKg: 1,
  slotId: key === "d" ? "gq" : "gp", published: true, version: 1, updatedAt: "2026-10-22T00:00:00.000Z", ...o,
});

const request = (o: Partial<PlanRequest> = {}): PlanRequest => ({
  itemId: "tomato", varietyId: null, quantityKg: 10, desiredDate: "2026-10-23", budgetYen: 8000, originPrefectures: ["大阪府"],
  slotId: "gp", allowIrregular: false, allowMixedVarieties: false, allowMixedGrades: false, allowFirstTime: true,
  preferredProducerId: null, ...o,
});

function plan(supplies: PlanSupply[], o: { req?: Partial<PlanRequest>; slot?: Partial<PlanSlot>; now?: Date; participants?: AllocateInput["participants"] } = {}): PlanResult {
  const keys = ["a", "b", "c", "e", "f"];
  return allocatePlan({
    request: request(o.req),
    supplies,
    slot: { ...slotP, ...o.slot },
    participants: o.participants ?? keys.map((k) => ({ slotId: "gp", producerId: `p-${k}`, confirmed: true })),
    relationships: [{ producerId: "p-a", priorTrade: true }, { producerId: "p-b", priorTrade: false }],
    now: o.now ?? NOW,
  });
}

const kgBy = (p: PlanResult) => Object.fromEntries(p.allocations.map((a) => [a.producerName, a.kg]));
const money = (p: PlanResult) => [p.productSubtotalYen, p.handoverFeeYen, p.totalYen];
const excludedOf = (p: PlanResult, name: string) => p.excluded.find((e) => e.producerName === name);

describe("受入ケース（仕様書 10.1）", () => {
  it("1: A10kg・B5kg → A10kg、6,000＋800＝6,800円。分割しない", () => {
    const p = plan([supply("a", 10), supply("b", 5)]);
    expect(p.status).toBe("MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 10 });
    expect(money(p)).toEqual([6000, 800, 6800]);
    expect(p.producerCount).toBe(1);
    expect(p.rankingReason?.code).toBe("SINGLE_PRODUCER");
    expect(p.reasonCodes).toEqual([]);
  });

  it("2: A5kg・B5kg → A5＋B5、5,750＋800＝6,550円。Bは初回", () => {
    const p = plan([supply("a", 5), supply("b", 5)]);
    expect(p.status).toBe("MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 5, B農園: 5 });
    expect(money(p)).toEqual([5750, 800, 6550]);
    expect(p.allocations.map((a) => [a.producerName, a.priorTrade])).toEqual([["A農園", true], ["B農園", false]]);
    expect(p.fulfilledKg).toBe(10);
    expect(p.shortageKg).toBe(0);
  });

  it("3: A5kg・B4kg → 最大9kg、5,200＋800＝6,000円、1kg不足。成功にしない", () => {
    const p = plan([supply("a", 5), supply("b", 4)]);
    expect(p.status).toBe("NOT_MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 5, B農園: 4 });
    expect(money(p)).toEqual([5200, 800, 6000]);
    expect([p.fulfilledKg, p.shortageKg]).toEqual([9, 1]);
    expect(p.reasonCodes).toContain("INSUFFICIENT_QUANTITY");
    expect(headlineText(p)).toBe("この検索条件・最大3農家では9kg。1kg不足");
  });

  it("4: A5kg・B3kg・C2kg公開 → A5＋B3＋C2、5,650＋800＝6,450円（固定費は1案に1回）", () => {
    const p = plan([supply("a", 5), supply("b", 3), supply("c", 2)]);
    expect(p.status).toBe("MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 5, B農園: 3, C農園: 2 });
    expect(money(p)).toEqual([5650, 800, 6450]);
  });

  it("5: A5kg・B10kg → B10kgのみ、5,500＋800＝6,300円。1農家優先の理由を返す", () => {
    const p = plan([supply("a", 5), supply("b", 10)]);
    expect(p.status).toBe("MATCHED");
    expect(kgBy(p)).toEqual({ B農園: 10 });
    expect(money(p)).toEqual([5500, 800, 6300]);
    expect(p.rankingReason).toEqual({ code: "FEWER_PRODUCERS", producerNames: ["B農園"], producerCount: 1 });
    expect(rankingText(p.rankingReason)).toBe("仕入れ先の数を優先したため、今回はB農園のみ");
  });

  it("6: D10kg（別枠G-Q・最安）はPの案に入らない", () => {
    const p = plan([supply("a", 5), supply("b", 5), supply("d", 10)]);
    expect(kgBy(p)).toEqual({ A農園: 5, B農園: 5 });
    expect(p.totalYen).toBe(6550);
    expect(excludedOf(p, "D農園")?.details).toEqual(["OTHER_SLOT"]);
    expect(excludedOf(p, "D農園")?.reasonCodes).toEqual(["HANDOVER_MISMATCH"]);
    // 別枠しかなければ D だけでも案にしない
    expect(plan([supply("d", 10)]).allocations).toEqual([]);
  });

  it("7: 初回不可で A5kg・B5kg → 最大5kg。BはFIRST_TIME_EXCLUDED", () => {
    const p = plan([supply("a", 5), supply("b", 5)], { req: { allowFirstTime: false } });
    expect(p.status).toBe("NOT_MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 5 });
    expect(money(p)).toEqual([3000, 800, 3800]);
    expect([p.fulfilledKg, p.shortageKg]).toEqual([5, 5]);
    expect(excludedOf(p, "B農園")?.reasonCodes).toEqual(["FIRST_TIME_EXCLUDED"]);
    expect(p.reasonCodes).toEqual(expect.arrayContaining(["INSUFFICIENT_QUANTITY", "FIRST_TIME_EXCLUDED"]));
  });

  it("8: A5＋B5・予算6,000円 → 10kg案は予算超過。予算内の最大9kgを示し、数量不足と区別する", () => {
    const p = plan([supply("a", 5), supply("b", 5)], { req: { budgetYen: 6000 } });
    expect(p.status).toBe("NOT_MATCHED");
    expect(p.reasonCodes).toContain("OVER_BUDGET");
    expect(p.reasonCodes).not.toContain("INSUFFICIENT_QUANTITY");
    expect(p.overBudget).toEqual({ kg: 10, totalYen: 6550 });
    expect(kgBy(p)).toEqual({ A農園: 5, B農園: 4 }); // 9kg案のうち取引済みAの数量が多い案
    expect(money(p)).toEqual([5200, 800, 6000]);
    expect(p.totalYen!).toBeLessThanOrEqual(6000);
    expect(headlineText(p)).toBe("予算内では9kgまで。1kg不足");
  });

  it("9: 共通枠の費用が未確認 → 確認が必要・総額未確定。予算内と判定しない", () => {
    const p = plan([supply("a", 10)], { slot: { feeConfirmed: false } });
    expect(p.status).toBe("NEEDS_CONFIRMATION");
    expect(p.reasonCodes).toEqual(["FEE_UNCONFIRMED"]);
    expect(p.totalYen).toBeNull();
    expect(p.handoverFeeYen).toBeNull();
    expect(p.budgetStatus).toBe("UNKNOWN");
    expect(p.productSubtotalYen).toBe(6000);
    // 条件確認が未了の場合も「確認が必要」
    expect(plan([supply("a", 10)], { slot: { conditionsConfirmed: false } }).status).toBe("NEEDS_CONFIRMATION");
  });

  it("10: 締切を過ぎる／B公開停止 → その供給を使わない", () => {
    const late = plan([supply("a", 5), supply("b", 5)], { now: new Date("2026-10-22T17:00:01+09:00") });
    expect(late.status).toBe("NOT_MATCHED");
    expect(late.allocations).toEqual([]);
    expect(late.reasonCodes).toContain("DEADLINE_PASSED");
    expect(excludedOf(late, "B農園")?.details).toContain("DEADLINE_PASSED");
    // 締切ちょうどはまだ有効
    expect(plan([supply("a", 10)], { now: new Date("2026-10-22T17:00:00+09:00") }).status).toBe("MATCHED");

    const paused = plan([supply("a", 5), supply("b", 5, { published: false })]);
    expect(kgBy(paused)).toEqual({ A農園: 5 });
    expect(excludedOf(paused, "B農園")?.details).toEqual(["NOT_PUBLISHED"]);
  });

  it("11: 品種が異なり混在未許可 → 合算しない", () => {
    const ss = [supply("a", 5), supply("b", 5, { varietyId: "v2", varietyName: "品種U" })];
    const p = plan(ss);
    expect(p.status).toBe("NOT_MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 5 });
    expect(p.reasonCodes).toContain("MIXING_NOT_ALLOWED");
    // 品種を指定した場合は、別品種を除外理由付きで外す
    const specified = plan(ss, { req: { varietyId: "v1" } });
    expect(excludedOf(specified, "B農園")?.details).toEqual(["VARIETY_MISMATCH"]);
    // 混在を明示的に許可したときだけ合算する
    expect(kgBy(plan(ss, { req: { allowMixedVarieties: true } }))).toEqual({ A農園: 5, B農園: 5 });
  });

  it("12: 最低販売量を満たさない配分は採用しない", () => {
    // B は最低3kg：A8＋B2 は不可、A7＋B3 を採用
    const p = plan([supply("a", 8), supply("b", 5, { minKg: 3 })]);
    expect(kgBy(p)).toEqual({ A農園: 7, B農園: 3 });
    for (const a of p.allocations) expect(a.kg).toBeGreaterThanOrEqual(a.supplyId === "s-b" ? 3 : 1);
    // 刻みで10kgちょうどにできない（A最低4kg・在庫9、B最低7kg） → 過剰購入せず9kg、LOT_CONSTRAINT
    const lot = plan([supply("a", 9, { minKg: 4 }), supply("b", 7, { minKg: 7 })]);
    expect([lot.fulfilledKg, lot.shortageKg]).toEqual([9, 1]);
    expect(lot.reasonCodes).toContain("LOT_CONSTRAINT");
    // 最低販売量が在庫を超える供給は除外
    expect(excludedOf(plan([supply("a", 5), supply("b", 5, { minKg: 6 })]), "B農園")?.details).toEqual(["MIN_EXCEEDS_STOCK"]);
  });

  it("13: 4農家でしか揃わない → SEARCH_SCOPE_LIMIT。地域全体の不足とは言わない", () => {
    const p = plan([supply("a", 3), supply("b", 3), supply("c", 3), supply("e", 3)]);
    expect(p.status).toBe("NOT_MATCHED");
    expect(p.reasonCodes).toContain("SEARCH_SCOPE_LIMIT");
    expect(p.reasonCodes).not.toContain("INSUFFICIENT_QUANTITY");
    expect([p.fulfilledKg, p.producerCount]).toEqual([9, 3]);
    expect(headlineText(p)).not.toMatch(/地域/);
  });
});

describe("探索・順位の細則", () => {
  it("同じ農家数なら取引済み農家の数量が多い案を優先する（A5＋B5 と A4＋C6 なら前者）", () => {
    // C は 6kg 単位でしか出せない → 2農家案は A5＋B5（A 5kg）と A4＋C6（A 4kg）
    const p = plan([supply("a", 5), supply("b", 5), supply("c", 6, { minKg: 6 })]);
    expect(kgBy(p)).toEqual({ A農園: 5, B農園: 5 });
  });

  it("安さより取引済み農家を優先したことを理由として返す", () => {
    // 最安は B5＋C5（5,250円）だが、取引済みAを最大限使う A5＋C5（5,500円）を採用する
    const p = plan([supply("a", 5), supply("b", 5), supply("c", 5)]);
    expect(kgBy(p)).toEqual({ A農園: 5, C農園: 5 });
    expect(p.rankingReason?.code).toBe("PRIOR_TRADE_FIRST");
  });

  it("指名した取引済み農家の数量を優先する", () => {
    const relationships = [{ producerId: "p-a", priorTrade: true }, { producerId: "p-e", priorTrade: true }];
    // 6kg は1農家では揃わない → 2農家案のうち、指名した E の数量が最も多い E5＋A1
    const base = { supplies: [supply("a", 5), supply("e", 5), supply("b", 4)], slot: slotP, now: NOW, relationships,
      participants: ["a", "b", "e"].map((k) => ({ slotId: "gp", producerId: `p-${k}`, confirmed: true })) };
    const p = allocatePlan({ ...base, request: request({ quantityKg: 6, preferredProducerId: "p-e" }) });
    expect(kgBy(p)).toEqual({ E農園: 5, A農園: 1 });
  });

  it("初回農家の指名は取引済み扱いしない（通知を返して優先なしで計算）", () => {
    const p = plan([supply("a", 10), supply("b", 10)], { req: { preferredProducerId: "p-b" } });
    expect(kgBy(p)).toEqual({ A農園: 10 });
    expect(p.notices).toContain("PREFERRED_NOT_PRIOR_TRADE");
  });

  it("枠の重量上限を超えない", () => {
    const p = plan([supply("a", 10), supply("b", 10)], { slot: { maxKg: 8 } });
    expect(p.fulfilledKg).toBe(8);
    expect(p.reasonCodes).toContain("SLOT_WEIGHT_LIMIT");
  });

  it("希望日と枠の日付が違えば組まない", () => {
    const p = plan([supply("a", 10)], { req: { desiredDate: "2026-10-24" } });
    expect(p.allocations).toEqual([]);
    expect(p.reasonCodes).toContain("HANDOVER_MISMATCH");
  });

  it("産地違い・規格外不可・在庫0 は既知の不一致として除外し、参加未確認だけの E は確認待ちの候補に残す", () => {
    const p = plan(
      [supply("a", 10, { originPrefecture: "京都府" }), supply("b", 10, { grade: "irregular", irregularReason: "形の不揃い" }), supply("c", 0), supply("e", 10)],
      { participants: ["a", "b", "c"].map((k) => ({ slotId: "gp", producerId: `p-${k}`, confirmed: true })).concat([{ slotId: "gp", producerId: "p-e", confirmed: false }]) },
    );
    expect(p.status).toBe("NEEDS_CONFIRMATION");
    expect(kgBy(p)).toEqual({ E農園: 10 });
    expect(excludedOf(p, "A農園")?.details).toEqual(["ORIGIN_MISMATCH"]);
    expect(excludedOf(p, "B農園")?.details).toEqual(["IRREGULAR_NOT_ALLOWED"]);
    expect(excludedOf(p, "C農園")?.details).toEqual(["NO_STOCK"]);
    expect(excludedOf(p, "E農園")).toBeUndefined();
  });

  it("枠参加が未確認なだけの供給は除外せず、それで揃う案は「確認が必要」（NEEDS_CONFIRMATION）の参考案にする", () => {
    const participants = [{ slotId: "gp", producerId: "p-a", confirmed: true }, { slotId: "gp", producerId: "p-b", confirmed: false }];
    const p = plan([supply("a", 5), supply("b", 5)], { participants });
    expect(p.status).toBe("NEEDS_CONFIRMATION");
    expect(p.reasonCodes).toEqual(["PARTICIPATION_UNCONFIRMED"]);
    expect(REASON_TEXT.PARTICIPATION_UNCONFIRMED).toBe("この生産者の受渡枠への参加確認が必要です");
    expect(kgBy(p)).toEqual({ A農園: 5, B農園: 5 });
    expect(money(p)).toEqual([5750, 800, 6550]);
    expect(p.allocations.map((a) => [a.producerName, a.participationConfirmed])).toEqual([["A農園", true], ["B農園", false]]);
    expect(excludedOf(p, "B農園")).toBeUndefined();
    expect(p.unconfirmedParticipants.map((u) => u.producerName)).toEqual(["B農園"]);
  });

  it("確認済みの供給だけで揃うなら、参加未確認の供給は使わず MATCHED にする", () => {
    const participants = [{ slotId: "gp", producerId: "p-a", confirmed: true }, { slotId: "gp", producerId: "p-b", confirmed: false }];
    const p = plan([supply("a", 10), supply("b", 10)], { participants });
    expect(p.status).toBe("MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 10 });
  });

  it("参加未確認でも揃わない場合の最大量は確認済みの供給だけで計算し、成功扱いにしない", () => {
    const participants = [{ slotId: "gp", producerId: "p-a", confirmed: true }, { slotId: "gp", producerId: "p-b", confirmed: false }];
    const p = plan([supply("a", 5), supply("b", 4)], { participants });
    expect(p.status).toBe("NOT_MATCHED");
    expect(kgBy(p)).toEqual({ A農園: 5 });
    expect(p.reasonCodes).toEqual(expect.arrayContaining(["INSUFFICIENT_QUANTITY", "PARTICIPATION_UNCONFIRMED"]));
  });

  it("参加未確認＋既知の不一致（別の枠・初回不可・産地違い）は確認待ちで救済しない", () => {
    // 別の枠 G-Q の参加未確認：不一致側（OTHER_SLOT）を優先して除外
    const otherSlot = plan([supply("a", 5), supply("e", 5, { slotId: "gq" })], {
      participants: [{ slotId: "gp", producerId: "p-a", confirmed: true }, { slotId: "gq", producerId: "p-e", confirmed: false }],
    });
    expect(otherSlot.status).toBe("NOT_MATCHED");
    expect(excludedOf(otherSlot, "E農園")?.details).toEqual(["OTHER_SLOT"]);
    expect(otherSlot.reasonCodes).not.toContain("PARTICIPATION_UNCONFIRMED");
    expect(kgBy(otherSlot)).toEqual({ A農園: 5 });

    const participants = [{ slotId: "gp", producerId: "p-a", confirmed: true }, { slotId: "gp", producerId: "p-b", confirmed: false }];
    const firstTime = plan([supply("a", 5), supply("b", 5)], { participants, req: { allowFirstTime: false } });
    expect(firstTime.status).toBe("NOT_MATCHED");
    expect(excludedOf(firstTime, "B農園")?.details).toEqual(["FIRST_TIME"]);
    const origin = plan([supply("a", 5), supply("b", 5, { originPrefecture: "京都府" })], { participants });
    expect(origin.status).toBe("NOT_MATCHED");
    expect(excludedOf(origin, "B農園")?.details).toEqual(["ORIGIN_MISMATCH"]);
    // 締切超過の枠は参加未確認でも救済しない
    const late = plan([supply("a", 5), supply("b", 5)], { participants, now: new Date("2026-10-22T17:00:01+09:00") });
    expect(late.status).toBe("NOT_MATCHED");
    expect(late.allocations).toEqual([]);
  });

  it("枠の参加者として登録されていない供給は、未確認ではなく既知の不一致として除外する", () => {
    const p = plan([supply("a", 5), supply("b", 5)], { participants: [{ slotId: "gp", producerId: "p-a", confirmed: true }] });
    expect(excludedOf(p, "B農園")?.details).toEqual(["NOT_SLOT_PARTICIPANT"]);
    expect(p.status).toBe("NOT_MATCHED");
  });

  it("対象供給が20件を超えたら先頭だけで計算せず、条件を絞るよう返す", () => {
    const many = Array.from({ length: MAX_CANDIDATE_SUPPLIES + 1 }, (_, i) =>
      supply(`x${String(i).padStart(2, "0")}`, 1, { producerId: `p-x${i}` }));
    const p = allocatePlan({
      request: request(), supplies: many, slot: slotP, now: NOW, relationships: [],
      participants: many.map((s) => ({ slotId: "gp", producerId: s.producerId, confirmed: true })),
    });
    expect(p.reasonCodes).toEqual(["TOO_MANY_SUPPLIES"]);
    expect(p.allocations).toEqual([]);
  });

  it("農家数は供給数ではなく producerId の種類数で数える", () => {
    // 同じ農家の供給は同時に使わない（1案に同一農家の別出品を重ねない）
    const p = plan([supply("a", 5), supply("a2", 5, { producerId: "p-a", producerName: "A農園" })]);
    expect(p.fulfilledKg).toBe(5);
  });

  it("案を作っても供給の数量は変えない", () => {
    const ss = [supply("a", 5), supply("b", 5)];
    const before = JSON.stringify(ss);
    plan(ss);
    expect(JSON.stringify(ss)).toBe(before);
  });

  it("計算に使った供給の version と計算時刻を返す", () => {
    const p = plan([supply("a", 10, { version: 3 })]);
    expect(p.supplySnapshot).toEqual([{ supplyId: "s-a", version: 3, updatedAt: "2026-10-22T00:00:00.000Z" }]);
    expect(p.allocations[0].version).toBe(3);
    expect(p.computedAt).toBe(NOW.toISOString());
  });
});
