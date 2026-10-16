import { describe, expect, it } from "vitest";
import { parsePlanRequest } from "./validate.js";

const NOW = new Date("2026-10-22T12:00:00+09:00");
const plan = (o: Record<string, unknown> = {}) => ({
  itemId: "demo-item-tomato", varietyId: null, quantityKg: 10, desiredDate: "2026-10-23", budgetYen: 8000,
  originPrefectures: ["大阪府"], slotId: "demo-slot-gp", allowFirstTime: true, allowIrregular: false,
  allowMixedVarieties: false, allowMixedGrades: false, preferredProducerId: null, ...o,
});

describe("仕入れ条件の検証", () => {
  it("確定済みの条件を受け付ける（品種指定なし・優先なしは null）", () => {
    const r = parsePlanRequest(plan(), NOW);
    expect(r.ok && r.value).toMatchObject({ varietyId: null, preferredProducerId: null, quantityKg: 10, budgetYen: 8000 });
  });

  it("予算は「上限なし」（null）を明示すれば受け付ける", () => {
    const r = parsePlanRequest(plan({ budgetYen: null }), NOW);
    expect(r.ok && r.value.budgetYen).toBeNull();
  });

  it("基準日時（DEMO_NOW 等）の当日は受け付け、前日は受け付けない", () => {
    expect(parsePlanRequest(plan({ desiredDate: "2026-10-22" }), NOW).ok).toBe(true);
    expect(parsePlanRequest(plan({ desiredDate: "2026-10-21" }), NOW).ok).toBe(false);
  });

  it.each([
    ["空", {}],
    ["品目なし", { itemId: "" }],
    ["不正なID", { itemId: "トマト; DROP" }],
    ["数量が小数", { quantityKg: 1.5 }],
    ["数量が0", { quantityKg: 0 }],
    ["数量が100kg超", { quantityKg: 101 }],
    ["数量が文字", { quantityKg: "たくさん" }],
    ["日付の形式違い", { desiredDate: "10/23" }],
    ["予算が未入力（上限なしとは扱わない）", { budgetYen: undefined }],
    ["予算が空文字", { budgetYen: "" }],
    ["予算が負", { budgetYen: -1 }],
    ["予算が小数", { budgetYen: 100.5 }],
    ["産地が空", { originPrefectures: [] }],
    ["産地が都道府県でない（受取場所を産地に入れた）", { originPrefectures: ["受渡拠点P"] }],
    ["受渡枠なし", { slotId: null }],
    ["初回可否が未選択", { allowFirstTime: null }],
    ["規格外可否が未選択", { allowIrregular: undefined }],
    ["品種混在が未選択", { allowMixedVarieties: "yes" }],
    ["規格混在が未選択", { allowMixedGrades: null }],
    ["優先農家IDが不正", { preferredProducerId: "<script>" }],
  ])("%s は受け付けない", (_, o) => {
    const body = _ === "空" ? {} : plan(o);
    expect(parsePlanRequest(body, NOW).ok).toBe(false);
  });
});
