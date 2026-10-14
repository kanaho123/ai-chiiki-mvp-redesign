import { describe, expect, it } from "vitest";
import { createPlan, type PlanRequest, type SupplyListing } from "./allocate";

const TODAY = "2026-10-14";
const DAY = "2026-10-16"; // 明後日

function listing(id: string, overrides: Partial<SupplyListing>): SupplyListing {
  return {
    id,
    producerName: `${id}農家`,
    item: "トマト",
    quantity: 1,
    unit: "kg",
    unitPrice: 500,
    availableDate: DAY,
    region: "大阪近郊",
    irregularReason: null,
    handoverPlace: "共通受渡拠点P",
    handoverStart: "10:00",
    handoverEnd: "11:00",
    minQuantity: 1,
    step: 1,
    handoverFee: 0,
    isPublic: true,
    ...overrides,
  };
}

const demo = (): SupplyListing[] => [
  listing("A", { quantity: 5, unitPrice: 600 }),
  listing("B", { quantity: 3, unitPrice: 550 }),
  listing("C", { quantity: 2, unitPrice: 350, irregularReason: "余剰・形の不揃い" }),
];

const request = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  item: "トマト",
  quantity: 10,
  unit: "kg",
  deadline: DAY,
  region: "大阪近郊",
  allowIrregular: true,
  maxUnitPrice: null,
  handoverPlace: null,
  handoverFrom: null,
  handoverTo: null,
  ...overrides,
});

const byProducer = (r: ReturnType<typeof createPlan>) =>
  Object.fromEntries(r.allocations.map((a) => [a.producerName, a.quantity]));

describe("デモ：トマト10kg", () => {
  it("規格外可なら A5kg＋B3kg＋C2kg＝10kg、商品代5,350円、受渡手数料0円", () => {
    const r = createPlan(request(), demo(), TODAY);
    expect(r.status).toBe("fulfilled");
    expect(r.message).toBe("条件を満たす10kgの仕入れ案が見つかりました");
    expect(byProducer(r)).toEqual({ A農家: 5, B農家: 3, C農家: 2 });
    expect(r.totalQuantity).toBe(10);
    expect(r.subtotal).toBe(5350);
    expect(r.handoverFee).toBe(0);
    expect(r.handover).toEqual({ date: DAY, place: "共通受渡拠点P", start: "10:00", end: "11:00" });
  });

  it("規格外不可なら A5kg＋B3kg＝8kg、2kg不足で成立としない", () => {
    const r = createPlan(request({ allowIrregular: false }), demo(), TODAY);
    expect(r.status).toBe("shortage");
    expect(r.message).toBe("希望10kgに対し、条件の合う登録数量は8kg。2kg不足");
    expect(byProducer(r)).toEqual({ A農家: 5, B農家: 3 });
    expect(r.subtotal).toBe(4650);
    expect(r.excluded.map((e) => e.producerName)).toEqual(["C農家"]);
  });

  it("C農家を1kgに減らすと9kg、1kg不足", () => {
    const ls = demo().map((l) => (l.id === "C" ? { ...l, quantity: 1 } : l));
    const r = createPlan(request(), ls, TODAY);
    expect(r.status).toBe("shortage");
    expect(r.totalQuantity).toBe(9);
    expect(r.shortage).toBe(1);
  });

  it("B農家が公開停止なら5＋2＝7kg", () => {
    const ls = demo().map((l) => (l.id === "B" ? { ...l, isPublic: false } : l));
    const r = createPlan(request(), ls, TODAY);
    expect(r.totalQuantity).toBe(7);
    expect(r.excluded[0].reasons).toContain("公開停止中");
  });

  it("在庫を超えて配分しない", () => {
    const r = createPlan(request({ quantity: 20 }), demo(), TODAY);
    for (const a of r.allocations) {
      const l = demo().find((x) => x.id === a.listingId)!;
      expect(a.quantity).toBeLessThanOrEqual(l.quantity);
    }
    expect(r.totalQuantity).toBe(10);
    expect(r.shortage).toBe(10);
  });
});

describe("受渡条件", () => {
  it("受渡日時・場所が異なる出品は組み合わせない（数量があっても成立しない）", () => {
    const ls = demo().map((l) => (l.id === "C" ? { ...l, handoverPlace: "拠点Q" } : l));
    const r = createPlan(request(), ls, TODAY);
    expect(r.status).toBe("handover_mismatch");
    expect(r.totalQuantity).toBe(8);
  });

  it("受渡場所の指定と照合する", () => {
    const r = createPlan(request({ handoverPlace: "拠点Q" }), demo(), TODAY);
    expect(r.status).toBe("none");
    expect(r.excluded).toHaveLength(3);
  });

  it("受渡時間の指定と照合する（出品の時間帯が指定時間内に収まること）", () => {
    expect(createPlan(request({ handoverFrom: "09:00", handoverTo: "12:00" }), demo(), TODAY).status).toBe("fulfilled");
    expect(createPlan(request({ handoverFrom: "10:30", handoverTo: "12:00" }), demo(), TODAY).status).toBe("none");
  });

  it("希望日は期限として扱い、それより前の受渡日も対象にする", () => {
    const r = createPlan(request({ deadline: "2026-10-20" }), demo(), TODAY);
    expect(r.status).toBe("fulfilled");
    expect(r.handover?.date).toBe(DAY);
    expect(createPlan(request({ deadline: "2026-10-15" }), demo(), TODAY).status).toBe("none");
  });
});

describe("条件の照合", () => {
  it("税込単価の上限を超える出品は除外する", () => {
    const r = createPlan(request({ maxUnitPrice: 560 }), demo(), TODAY);
    expect(byProducer(r)).toEqual({ B農家: 3, C農家: 2 });
  });

  it("地域が異なる出品は除外する", () => {
    const ls = demo().map((l) => (l.id === "A" ? { ...l, region: "北摂" } : l));
    expect(createPlan(request(), ls, TODAY).totalQuantity).toBe(5);
  });

  it("単位が異なる在庫は換算せず除外し、案内を出す", () => {
    const ls = [...demo(), listing("D", { quantity: 50, unit: "個" })];
    const r = createPlan(request(), ls, TODAY);
    expect(r.totalQuantity).toBe(10);
    expect(r.allocations.some((a) => a.listingId === "D")).toBe(false);
    expect(r.notices).toHaveLength(1);
  });
});

describe("最低販売量・販売刻み", () => {
  it("販売刻みが違うだけでは除外しない：2kg刻みの出品から2kgを配分できる", () => {
    const ls = [listing("A", { quantity: 8, unitPrice: 600 }), listing("C", { quantity: 6, minQuantity: 2, step: 2, unitPrice: 350 })];
    const r = createPlan(request(), ls, TODAY);
    expect(r.status).toBe("fulfilled");
    expect(byProducer(r)).toEqual({ A農家: 4, C農家: 6 });
  });

  it("販売刻みを守れない端数は配分しない（勝手に丸めない）", () => {
    const ls = [listing("A", { quantity: 9, minQuantity: 3, step: 3 })];
    const r = createPlan(request(), ls, TODAY);
    expect(r.totalQuantity).toBe(9);
    expect(r.shortage).toBe(1);
  });

  it("最低販売量を下回る配分をしない", () => {
    const ls = [listing("A", { quantity: 9 }), listing("B", { quantity: 5, minQuantity: 5 })];
    const r = createPlan(request(), ls, TODAY);
    expect(r.status).toBe("fulfilled");
    for (const a of r.allocations) if (a.listingId === "B") expect(a.quantity).toBeGreaterThanOrEqual(5);
  });

  it("成立案が複数あれば仕入れ先が少ない案を優先し、次に安い案", () => {
    const ls = [
      listing("A", { quantity: 10, unitPrice: 700 }),
      listing("B", { quantity: 5, unitPrice: 300 }),
      listing("C", { quantity: 5, unitPrice: 300 }),
    ];
    expect(byProducer(createPlan(request(), ls, TODAY))).toEqual({ A農家: 10 });
  });
});
