import { describe, expect, it } from "vitest";
import { createPlan, type PlanRequest, type SupplyListing } from "./allocate.js";
import { suggestAllowIrregular } from "./suggest.js";

const TODAY = "2026-10-14";
const DAY = "2026-10-16";

const listing = (id: string, o: Partial<SupplyListing>): SupplyListing => ({
  id, producerId: `p-${id}`, producerName: `${id}農家`, item: "トマト", variety: null, quantity: 1, unit: "kg",
  unitPrice: 500, availableDate: DAY, region: "大阪近郊", irregularReason: null, handoverPlace: "共通受渡拠点P",
  handoverStart: "10:00", handoverEnd: "11:00", minQuantity: 1, step: 1, handoverFee: 0, isPublic: true, ...o,
});

const demo = (c: Partial<SupplyListing> = {}) => [
  listing("A", { quantity: 5, unitPrice: 600 }),
  listing("B", { quantity: 3, unitPrice: 550 }),
  listing("C", { quantity: 2, unitPrice: 350, irregularReason: "余剰・形の不揃い", ...c }),
];

const request = (o: Partial<PlanRequest> = {}): PlanRequest => ({
  item: "トマト", variety: null, quantity: 10, unit: "kg", deadline: DAY, region: "大阪近郊", allowIrregular: false,
  maxUnitPrice: null, handoverPlace: null, handoverFrom: null, handoverTo: null, ...o,
});

const suggest = (req: PlanRequest, ls: SupplyListing[]) => suggestAllowIrregular(req, createPlan(req, ls, TODAY), ls, TODAY);

describe("不足時の条件変更候補：規格外の許容", () => {
  it("規格外不可で8kg不足のとき、規格外可なら満たせるので、C農家の2kgを示して案内する", () => {
    const s = suggest(request(), demo());
    expect(s).toMatchObject({ type: "allow_irregular", irregular: [{ producerName: "C農家", quantity: 2, unit: "kg" }] });
    expect(s!.message).toBe("形の不揃い・余剰も使うと、C農家の2kg（余剰・形の不揃い）を含めて希望10kgを満たす案を作れます");
  });

  it("C農家が1kgなら規格外を許容しても9kgで届かないので、案内しない", () => {
    expect(suggest(request(), demo({ quantity: 1 }))).toBeNull();
  });

  it("すでに規格外可、または希望量を満たしているときは案内しない", () => {
    expect(suggest(request({ allowIrregular: true }), demo({ quantity: 1 }))).toBeNull();
    expect(suggest(request({ quantity: 8 }), demo())).toBeNull();
  });

  it("他の条件は変えない：価格上限・受渡場所・日付・地域・品種に合わない規格外品は使わない", () => {
    expect(suggest(request({ maxUnitPrice: 300 }), demo())).toBeNull();
    expect(suggest(request(), demo({ handoverPlace: "別の拠点Q" }))).toBeNull();
    expect(suggest(request(), demo({ availableDate: "2026-10-20" }))).toBeNull();
    expect(suggest(request(), demo({ region: "北摂" }))).toBeNull();
    expect(suggest(request({ variety: "桃太郎" }), demo().map((l) => ({ ...l, variety: l.id === "C" ? null : "桃太郎" })))).toBeNull();
  });

  it("最低販売量・販売刻みを守れない規格外品では満たせないので案内しない", () => {
    // A は5kg単位、B・C は3kg単位でしか出せない → 5＋3＝8、5＋3＋3＝11 で、ちょうど10kgは作れない
    const ls = demo({ quantity: 3, minQuantity: 3, step: 3 }).map((l) =>
      l.id === "A" ? { ...l, minQuantity: 5, step: 5 } : l.id === "B" ? { ...l, minQuantity: 3, step: 3 } : l,
    );
    expect(suggest(request(), ls)).toBeNull();
  });

  it("候補を作っても出品の数量は変わらない", () => {
    const ls = demo();
    const before = JSON.stringify(ls);
    suggest(request(), ls);
    expect(JSON.stringify(ls)).toBe(before);
  });
});
