import { describe, expect, it } from "vitest";
import { jstDate } from "./dates.js";
import { parseListingInput, parseListingPatch, parsePlanRequest } from "./validate.js";

const plan = (o: Record<string, unknown> = {}) => ({
  item: "トマト", quantity: 10, unit: "kg", deadline: jstDate(2), region: "大阪近郊", allowIrregular: true, ...o,
});

const listing = (o: Record<string, unknown> = {}) => ({
  producerName: "A農家", item: "トマト", quantity: 5, unit: "kg", unitPrice: 600, availableDate: jstDate(2),
  region: "大阪近郊", handoverPlace: "共通受渡拠点P", handoverStart: "10:00", handoverEnd: "11:00",
  minQuantity: 1, step: 1, handoverFee: 0, ...o,
});

describe("仕入れ条件の検証", () => {
  it("正しい条件を受け付け、未入力の任意項目は「指定なし」（null）にする", () => {
    const r = parsePlanRequest(plan());
    expect(r.ok && r.value).toMatchObject({ variety: null, maxUnitPrice: null, handoverPlace: null, handoverFrom: null });
  });

  it("空なら品目・数量・希望日の入力を促す", () => {
    expect(parsePlanRequest({})).toEqual({ ok: false, error: "品目・数量・希望日を入力してください" });
  });

  it.each([
    ["数量が小数", { quantity: 1.5 }],
    ["数量が0", { quantity: 0 }],
    ["数量が文字", { quantity: "たくさん" }],
    ["価格上限が負", { maxUnitPrice: -1 }],
    ["受渡時間の形式違い", { handoverFrom: "25:00" }],
    ["受渡時間が逆順", { handoverFrom: "11:00", handoverTo: "10:00" }],
    ["過去の希望日", { deadline: jstDate(-1) }],
    ["選択肢にない地域", { region: "東京" }],
    ["規格外可否が未選択", { allowIrregular: null }],
  ])("%s は受け付けない", (_, o) => {
    expect(parsePlanRequest(plan(o)).ok).toBe(false);
  });
});

describe("出品の検証", () => {
  it("正しい出品を受け付ける", () => {
    expect(parseListingInput(listing()).ok).toBe(true);
  });

  it.each([
    ["数量が小数", { quantity: 2.5 }],
    ["数量が負", { quantity: -1 }],
    ["単価が負", { unitPrice: -100 }],
    ["単価が小数", { unitPrice: 600.5 }],
    ["最低販売量が0", { minQuantity: 0 }],
    ["販売刻みが0", { step: 0 }],
    ["受渡時間が逆順", { handoverStart: "11:00", handoverEnd: "10:00" }],
    ["受渡時間の形式違い", { handoverStart: "10時" }],
    ["受渡手数料が負", { handoverFee: -1 }],
  ])("%s は受け付けない", (_, o) => {
    expect(parseListingInput(listing(o)).ok).toBe(false);
  });

  it("数量変更は0以上の整数だけ受け付ける", () => {
    expect(parseListingPatch({ quantity: 1 }).ok).toBe(true);
    expect(parseListingPatch({ quantity: 1.5 }).ok).toBe(false);
    expect(parseListingPatch({ quantity: -1 }).ok).toBe(false);
  });
});
