import { describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ prisma: {} }));
const { rankOptions } = await import("./plan-options");
type Opt = Parameters<typeof rankOptions>[0][number];

const opt = (slotId: string, o: Partial<Opt>): Opt => ({
  slotId, label: slotId, placeName: slotId, placeAddress: "", placeKind: null, startAt: "2026-10-23T07:00:00.000Z", endAt: "2026-10-23T09:00:00.000Z",
  status: "MATCHED", requestedKg: 10, fulfilledKg: 10, shortageKg: 0, producerCount: 1, totalYen: 6000, farms: [], ...o,
});

describe("おすすめの受け取り方の並べ方（受け取り1か所の案どうし）", () => {
  it("必要量を確保できる案が先 → 1農家が最優先 → 農家が少ない順 → 合計が安い順 → 時間が早い順", () => {
    const ranked = rankOptions([
      opt("x-2farms", { producerCount: 2, totalYen: 5000 }),
      opt("y-short", { status: "NOT_MATCHED", fulfilledKg: 8, shortageKg: 2, producerCount: 1, totalYen: 4000 }),
      opt("z-1farm-expensive", { producerCount: 1, totalYen: 7000 }),
      opt("w-1farm-cheap", { producerCount: 1, totalYen: 6500 }),
      opt("v-3farms", { producerCount: 3, totalYen: 4500 }),
    ]);
    expect(ranked.map((o) => o.slotId)).toEqual(["w-1farm-cheap", "z-1farm-expensive", "x-2farms", "v-3farms", "y-short"]);
  });
  it("どこでも必要量に届かないときは、多く確保できる案を先にする（不足の理由は既存の画面で示す）", () => {
    const ranked = rankOptions([
      opt("a", { status: "NOT_MATCHED", fulfilledKg: 5, shortageKg: 5 }),
      opt("b", { status: "NOT_MATCHED", fulfilledKg: 9, shortageKg: 1 }),
    ]);
    expect(ranked.map((o) => o.slotId)).toEqual(["b", "a"]);
  });
  it("合計が未確定（null）の案は、同じ条件なら後ろ", () => {
    expect(rankOptions([opt("unknown", { totalYen: null }), opt("known", { totalYen: 9000 })]).map((o) => o.slotId)).toEqual(["known", "unknown"]);
  });
});
