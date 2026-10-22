import { describe, expect, it } from "vitest";
import { parsePlanRequest, parseSupplyInput, parseSupplyPatch } from "./validate.js";

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
    ["優先農家IDが不正", { preferredProducerId: "<script>" }],
  ])("%s は受け付けない", (_, o) => {
    const body = _ === "空" ? {} : plan(o);
    expect(parsePlanRequest(body, NOW).ok).toBe(false);
  });
  it("品種・規格を「まぜてよいか」は送らなくてよく、品種の指定と規格外の可否から決まる", () => {
    const without = (o: Record<string, unknown>) => { const b = plan(o) as Record<string, unknown>; delete b.allowMixedVarieties; delete b.allowMixedGrades; return b; };
    const v = (o: Record<string, unknown>) => { const r = parsePlanRequest(without(o), NOW); return r.ok && { mv: r.value.allowMixedVarieties, mg: r.value.allowMixedGrades }; };
    expect(v({ varietyId: null, allowIrregular: true })).toEqual({ mv: true, mg: true }); // 品種の指定なし → どの品種でも／規格外も可 → まぜてよい
    expect(v({ varietyId: "v1", allowIrregular: false })).toEqual({ mv: false, mg: false }); // 品種を指定 → その品種だけ／規格外は使わない
    expect(parsePlanRequest(without({ allowMixedVarieties: "yes" }), NOW).ok).toBe(true); // 形の違う値も使わない（規則で決める）
  });
  it("保存済みの相談の条件（以前は画面で選んでいた値）は、送られた値をそのまま使う（案と fingerprint が変わらない）", () => {
    const r = parsePlanRequest(plan({ varietyId: null, allowIrregular: true, allowMixedVarieties: false, allowMixedGrades: false }), NOW);
    expect(r.ok && [r.value.allowMixedVarieties, r.value.allowMixedGrades]).toEqual([false, false]);
  });
});

describe("供給の登録・変更の検証", () => {
  const supply = (o: Record<string, unknown> = {}) => ({
    itemId: "i", varietyId: "v", grade: "irregular", irregularReason: "", originPrefecture: "大阪府",
    availableKg: 5, priceYenPerKg: 600, minKg: 1, slotId: "s", published: true, ...o,
  });
  it("規格外の理由は任意：空欄・未指定でも登録できる（null で保存）", () => {
    expect(parseSupplyInput(supply())).toMatchObject({ ok: true, value: { grade: "irregular", irregularReason: null } });
    expect(parseSupplyInput(supply({ irregularReason: undefined }))).toMatchObject({ ok: true, value: { irregularReason: null } });
    expect(parseSupplyInput(supply({ irregularReason: "  形の不揃い  " }))).toMatchObject({ ok: true, value: { irregularReason: "形の不揃い" } });
    expect(parseSupplyInput(supply({ irregularReason: "あ".repeat(31) }))).toMatchObject({ ok: false });
    expect(parseSupplyInput(supply({ grade: "regular", irregularReason: "書いても" }))).toMatchObject({ ok: true, value: { irregularReason: null } });
  });
  it("価格の変更：1円以上の整数だけ。数量・公開と同じく version が必要", () => {
    expect(parseSupplyPatch({ version: 3, priceYenPerKg: 650 })).toEqual({ ok: true, value: { version: 3, priceYenPerKg: 650 } });
    expect(parseSupplyPatch({ version: 3, priceYenPerKg: 0 })).toMatchObject({ ok: false });
    expect(parseSupplyPatch({ version: 3, priceYenPerKg: 12.5 })).toMatchObject({ ok: false });
    expect(parseSupplyPatch({ priceYenPerKg: 650 })).toMatchObject({ ok: false });
    expect(parseSupplyPatch({ version: 3 })).toMatchObject({ ok: false, error: "変更内容がありません" });
  });
});
