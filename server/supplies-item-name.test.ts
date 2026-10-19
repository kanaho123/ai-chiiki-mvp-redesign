import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 出品の登録 POST /api/supplies：品目名（itemName）での登録。
// 既存の品目と照合の鍵が同じならその品目を使い、なければ一般向けの環境だけ新しい品目を作る。demo では作らない。
const mem = vi.hoisted(() => ({
  items: [] as { id: string; name: string; varieties: { id: string; name: string }[] }[],
  created: [] as Record<string, unknown>[],
  newItems: [] as string[],
  dup: false,
}));

vi.mock("./auth.js", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u-p", role: "producer", producer: { id: "p-1", farmName: "テスト農園", originPrefecture: "大阪府" } } }),
}));
vi.mock("./repo.js", () => ({
  repo: {
    producerSlots: async () => [{ id: "slot-1" }],
    itemsWithVarieties: async () => mem.items,
    // 本物は品目・品種・出品を1つの transaction で作る（repo-new-item-tx.test.ts）
    createSupplyWithNewItem: async (name: string, data: Record<string, unknown>) => {
      mem.newItems.push(name);
      const n = mem.newItems.length;
      mem.created.push({ ...data, itemId: `i-new-${n}`, varietyId: `v-new-${n}` });
      return { id: "sp-new", item: { name }, availableKg: data.availableKg };
    },
    createSupply: async (data: Record<string, unknown>) => {
      if (mem.dup) return null;
      mem.created.push(data);
      const item = mem.items.find((i) => i.id === data.itemId)!;
      return { id: "sp-1", item: { name: item.name }, availableKg: data.availableKg };
    },
  },
}));
const supplies = await import("./routes/supplies/index.js");

const post = (body: Record<string, unknown>) => supplies.POST(new Request("http://localhost/api/supplies", {
  method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
  body: JSON.stringify({ grade: "regular", originPrefecture: "大阪府", availableKg: 3, priceYenPerKg: 800, minKg: 1, slotId: "slot-1", published: true, ...body }),
}));

beforeEach(() => {
  mem.items = [
    { id: "i-nasu", name: "なす", varieties: [{ id: "v-nasu", name: "指定なし" }] },
    { id: "i-tomato", name: "トマト", varieties: [{ id: "v-tomato", name: "指定なし" }] },
  ];
  mem.created = []; mem.newItems = []; mem.dup = false;
  vi.stubEnv("APP_MODE", "general");
});
afterEach(() => vi.unstubAllEnvs());

describe("出品の登録：品目名での登録", () => {
  it("一般向け：新しい品目名（万願寺とうがらし）は品目と「指定なし」を作って出品する", async () => {
    const res = await post({ itemName: "万願寺とうがらし" });
    expect(res.status).toBe(201);
    expect(mem.newItems).toEqual(["万願寺とうがらし"]);
    expect(mem.created[0]).toMatchObject({ itemId: "i-new-1", varietyId: "v-new-1", producerId: "p-1", availableKg: 3 });
    expect(mem.created[0]).not.toHaveProperty("itemName");
  });
  it("表記の違い（ナス）は既存の品目（なす）を使い、新しく作らない", async () => {
    const res = await post({ itemName: "ナス" });
    expect(res.status).toBe(201);
    expect(mem.newItems).toEqual([]);
    expect(mem.created[0]).toMatchObject({ itemId: "i-nasu", varietyId: "v-nasu" });
  });
  it("既存の品目（itemId・品種）での登録は今までどおり", async () => {
    expect((await post({ itemId: "i-tomato", varietyId: "v-tomato" })).status).toBe(201);
    expect(mem.created[0]).toMatchObject({ itemId: "i-tomato", varietyId: "v-tomato" });
    expect((await post({ itemId: "i-tomato", varietyId: "v-x" })).status).toBe(400); // 品種が違う
  });
  it("同じ品目・同じ受け渡しの回の出品がすでにあれば、今までどおり 409", async () => {
    mem.dup = true;
    const res = await post({ itemName: "トマト" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("数量の変更をご利用ください");
  });
  it("品目名の形が違えば 400（品目は作らない）", async () => {
    const res = await post({ itemName: "<script>" });
    expect(res.status).toBe(400);
    expect(mem.newItems).toEqual([]);
  });
  it("デモ用の環境：新しい品目は作らない（既存の品目名なら登録できる）", async () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("DEMO_NOW", "2026-10-22T12:00:00+09:00");
    const res = await post({ itemName: "万願寺とうがらし" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("登録済みの品目から選んでください");
    expect(mem.newItems).toEqual([]);
    expect((await post({ itemName: "とまと" })).status).toBe(201);
  });
});
