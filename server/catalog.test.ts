import { describe, expect, it, vi } from "vitest";
import type { ExtractedRequest } from "../src/lib/validate.js";
import { resolveExtraction } from "../src/lib/resolve.js";

// 受け渡しの場所の住所の扱い：飲食店へ返すカタログには住所を入れない。
// AI 読み取りの照合（サーバーの中）では、運営の場所の住所だけ使い、生産者が登録した場所は名前でだけ照合する。
const PRIVATE_ADDRESS = "大阪府堺市南区桃山台9-9-9";
vi.mock("./db.js", () => {
  const slot = (id: string, place: { name: string; address: string; kind: string | null; ownerProducerId: string | null }) => ({
    id, label: id, startAt: new Date("2026-10-23T07:00:00.000Z"), endAt: new Date("2026-10-23T09:00:00.000Z"),
    confirmDeadlineAt: new Date("2026-10-22T14:00:00.000Z"), feeYen: 0, feeConfirmed: true, maxKg: 100, place,
  });
  return {
    prisma: {
      item: { findMany: async () => [{ id: "i-tomato", name: "トマト", varieties: [{ id: "v-1", name: "指定なし" }] }] },
      handoverSlot: {
        findMany: async () => [
          slot("slot-umeda", { name: "梅田エリア受渡所（仮）", address: "大阪市北区（詳しい場所は確定後にご案内します）", kind: null, ownerProducerId: null }),
          slot("slot-farm", { name: "山田農園の作業場", address: PRIVATE_ADDRESS, kind: "farm", ownerProducerId: "p-yamada" }),
          slot("slot-store", { name: "南区ふれあい直売所", address: "大阪府堺市南区1-2-3", kind: "direct_store", ownerProducerId: "p-yamada" }),
        ],
      },
      relationship: { findMany: async () => [] },
      producer: { findMany: async () => [{ id: "p-yamada", farmName: "山田農園" }] },
    },
  };
});
const { loadCatalog, publicCatalog } = await import("./catalog.js");

const none: ExtractedRequest = {
  itemText: null, varietyText: null, quantityKg: null, dateText: null, budgetYen: null, budgetIncludesHandoverFee: null, budgetUnlimited: null,
  originText: null, handoverText: null, preferredProducerText: null, producerRequired: null, allowFirstTime: null, allowIrregular: null,
  allowMixedVarieties: null, allowMixedGrades: null,
};
const NOW = new Date("2026-10-20T12:00:00+09:00");

describe("カタログの受け渡しの場所の住所", () => {
  it("飲食店へ返すカタログには、どの場所の住所も入らない（名前・種類・日時は返す）", async () => {
    const shown = publicCatalog(await loadCatalog("u-r"));
    const text = JSON.stringify(shown);
    expect(text).not.toContain("placeAddress");
    expect(text).not.toContain(PRIVATE_ADDRESS);
    expect(text).not.toContain("堺市南区1-2-3");
    expect(text).not.toContain("大阪市北区");
    expect(shown.slots.map((s) => [s.placeName, s.placeKind])).toEqual([["梅田エリア受渡所（仮）", null], ["山田農園の作業場", "farm"], ["南区ふれあい直売所", "direct_store"]]);
  });
  it("照合用（サーバーの中）でも、生産者が登録した場所の住所は空。運営の場所の住所はそのまま", async () => {
    const internal = await loadCatalog("u-r");
    expect(internal.slots.map((s) => s.placeAddress)).toEqual(["大阪市北区（詳しい場所は確定後にご案内します）", "", ""]);
  });
  it("AI 読み取り：生産者が登録した場所の住所を書いても照合しない。場所の名前なら照合する。運営の場所は住所でも照合する", async () => {
    const catalog = await loadCatalog("u-r");
    const slotOf = (handoverText: string) => resolveExtraction({ ...none, handoverText, dateText: "10月23日" }, catalog, NOW).draft.slotId;
    expect(slotOf(`${PRIVATE_ADDRESS}で受け取り`)).toBeNull();
    expect(slotOf("堺市南区1-2-3で受け取り")).toBeNull();
    expect(slotOf("山田農園の作業場で受け取り")).toBe("slot-farm");
    expect(slotOf("南区ふれあい直売所で")).toBe("slot-store");
    expect(slotOf("梅田で受け取り")).toBe("slot-umeda");
    expect(slotOf("北区で受け取り")).toBe("slot-umeda"); // 運営の場所の住所（公開前提の文）では今までどおり
  });
});
