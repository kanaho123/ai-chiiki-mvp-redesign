import { describe, expect, it } from "vitest";
import { allocatePlan, type PlanRequest, type PlanSupply } from "./allocate.js";
import { suggestConditionChanges } from "./suggest.js";

const NOW = new Date("2026-10-22T12:00:00+09:00");
const slot = {
  id: "gp", label: "G-P", placeName: "受渡拠点P", startAt: "2026-10-23T10:00:00+09:00", endAt: "2026-10-23T11:00:00+09:00",
  confirmDeadlineAt: "2026-10-22T17:00:00+09:00", feeYen: 800, feeConfirmed: true, maxKg: 20, conditionsConfirmed: true,
};
const supply = (key: string, availableKg: number, o: Partial<PlanSupply> = {}): PlanSupply => ({
  id: `s-${key}`, producerId: `p-${key}`, producerName: `${key.toUpperCase()}農園`, itemId: "tomato", varietyId: "v1", varietyName: "品種T",
  grade: "regular", irregularReason: null, originPrefecture: "大阪府", availableKg, priceYenPerKg: 500, minKg: 1, slotId: "gp",
  published: true, version: 1, updatedAt: "2026-10-22T00:00:00.000Z", ...o,
});
const request = (o: Partial<PlanRequest> = {}): PlanRequest => ({
  itemId: "tomato", varietyId: null, quantityKg: 10, desiredDate: "2026-10-23", budgetYen: null, originPrefectures: ["大阪府"],
  slotId: "gp", allowIrregular: false, allowMixedVarieties: false, allowMixedGrades: false, allowFirstTime: true,
  preferredProducerId: null, ...o,
});
const run = (supplies: PlanSupply[], o: Partial<PlanRequest> = {}) => {
  const req = request(o);
  const plan = allocatePlan({
    request: req, supplies, slot, now: NOW, relationships: [{ producerId: "p-a", priorTrade: true }],
    participants: supplies.map((s) => ({ slotId: "gp", producerId: s.producerId, confirmed: true })),
  });
  return { req, plan, suggestions: suggestConditionChanges(req, plan) };
};
const types = (r: ReturnType<typeof run>) => r.suggestions.map((s) => s.type);

describe("条件変更の候補（自動適用しない）", () => {
  it("適合した案には候補を出さない", () => {
    expect(run([supply("a", 10)]).suggestions).toEqual([]);
  });

  it("初回不可で不足したら「初回の農家を含める」を候補にする", () => {
    const r = run([supply("a", 5), supply("b", 5)], { allowFirstTime: false });
    expect(types(r)).toContain("allow_first_time");
    expect(r.suggestions.find((s) => s.type === "allow_first_time")?.change).toEqual({ allowFirstTime: true });
  });

  it("規格外不可で除外された供給があれば「規格外を許可する」を候補にする", () => {
    expect(types(run([supply("a", 5), supply("b", 5, { grade: "irregular", irregularReason: "形の不揃い" })]))).toContain("allow_irregular");
  });

  it("品種違いで合算できないときは「品種の混在を許可する」を候補にする", () => {
    expect(types(run([supply("a", 5), supply("b", 5, { varietyId: "v2" })]))).toContain("allow_mixed_varieties");
  });

  it("予算超過では予算の見直しを候補にし、数量は利用者が選んだときだけ変える", () => {
    const r = run([supply("a", 5), supply("b", 5)], { budgetYen: 5000 });
    expect(types(r)).toEqual(expect.arrayContaining(["review_budget", "reduce_quantity"]));
    expect(r.suggestions.find((s) => s.type === "review_budget")?.change).toBeNull();
  });

  it("候補を作っても条件・供給は変わらない", () => {
    const ss = [supply("a", 5), supply("b", 5)];
    const before = JSON.stringify(ss);
    const r = run(ss, { allowFirstTime: false });
    expect(r.req.allowFirstTime).toBe(false);
    expect(JSON.stringify(ss)).toBe(before);
  });
});
