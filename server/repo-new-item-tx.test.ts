import { beforeEach, describe, expect, it, vi } from "vitest";

// 新しい品目名での出品（repo.createSupplyWithNewItem）：品目・品種「指定なし」・出品は1つの transaction。
// 出品の作成に失敗したら、品目も品種も残らない。DB は本物と同じく「transaction の中の例外なら中身をすべて取り消す」差し替え。
type Item = { id: string; name: string };
type Variety = { id: string; itemId: string; name: string };
type Supply = { id: string; itemId: string; varietyId: string; producerId: string; slotId: string };
type State = { items: Item[]; varieties: Variety[]; supplies: Supply[] };
const mem = vi.hoisted(() => ({ state: null as unknown as State, failOn: null as string | null, seq: 0, transactions: 0 }));

vi.mock("./db.js", () => {
  const uniqueError = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  const view = (s: State, sp: Supply) => ({
    ...sp, grade: "regular", irregularReason: null, originPrefecture: "大阪府", availableKg: 3, priceYenPerKg: 800, minKg: 1, published: false, version: 1, updatedAt: new Date("2026-10-20T00:00:00Z"),
    item: s.items.find((i) => i.id === sp.itemId)!, variety: s.varieties.find((v) => v.id === sp.varietyId)!,
    slot: { id: sp.slotId, label: "金曜", startAt: new Date("2026-10-23T03:00:00Z"), endAt: new Date("2026-10-23T04:00:00Z"), confirmDeadlineAt: new Date("2026-10-22T09:00:00Z"), place: { id: "pl", name: "場所", address: "住所" } },
  });
  const client = () => {
    const s = mem.state;
    return {
      item: {
        create: async ({ data }: { data: { name: string; varieties: { create: { name: string } } } }) => {
          if (mem.failOn === "item.create") throw new Error("injected failure at item.create");
          if (s.items.some((i) => i.name === data.name)) throw uniqueError();
          const item = { id: `i-${++mem.seq}`, name: data.name };
          s.items.push(item);
          const v = { id: `v-${++mem.seq}`, itemId: item.id, name: data.varieties.create.name };
          s.varieties.push(v);
          return { ...item, varieties: [v] };
        },
        findUnique: async ({ where }: { where: { name: string } }) => {
          const i = s.items.find((x) => x.name === where.name);
          return i ? { ...i, varieties: s.varieties.filter((v) => v.itemId === i.id) } : null;
        },
      },
      supply: {
        findFirst: async ({ where }: { where: Omit<Supply, "id" | "varietyId"> }) =>
          s.supplies.find((x) => x.producerId === where.producerId && x.itemId === where.itemId && x.slotId === where.slotId) ?? null,
        create: async ({ data }: { data: Supply }) => {
          if (mem.failOn === "supply.create") throw new Error("injected failure at supply.create");
          const sp = { ...data, id: `sp-${++mem.seq}` };
          s.supplies.push(sp);
          return view(s, sp);
        },
      },
    };
  };
  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      mem.transactions++;
      const snapshot = structuredClone(mem.state);
      try {
        return await fn(client());
      } catch (e) {
        mem.state = snapshot;
        throw e;
      }
    },
  };
  return { prisma: new Proxy(prisma, { get: (t, k: string) => (k === "$transaction" ? t.$transaction : (client() as Record<string, unknown>)[k]) }) };
});
const { repo } = await import("./repo.js");

const data = { producerId: "p-1", slotId: "slot-1", grade: "regular" as const, irregularReason: null, originPrefecture: "大阪府", availableKg: 3, priceYenPerKg: 800, minKg: 1, published: false };

beforeEach(() => {
  mem.state = { items: [{ id: "i-tomato", name: "トマト" }], varieties: [{ id: "v-tomato", itemId: "i-tomato", name: "指定なし" }], supplies: [] };
  mem.failOn = null; mem.seq = 0; mem.transactions = 0;
});

describe("新しい品目名での出品：品目・品種・出品を1つの transaction で作る", () => {
  it("成功：品目・品種「指定なし」・出品がそろって作られる（transaction は1回）", async () => {
    const sp = await repo.createSupplyWithNewItem("万願寺とうがらし", data);
    expect(sp?.item.name).toBe("万願寺とうがらし");
    expect(mem.transactions).toBe(1);
    const item = mem.state.items.find((i) => i.name === "万願寺とうがらし")!;
    expect(mem.state.varieties.filter((v) => v.itemId === item.id).map((v) => v.name)).toEqual(["指定なし"]);
    expect(mem.state.supplies).toMatchObject([{ itemId: item.id, producerId: "p-1", slotId: "slot-1" }]);
  });
  it("出品の作成に失敗したら全体を取り消す：品目も品種も残らない", async () => {
    mem.failOn = "supply.create";
    await expect(repo.createSupplyWithNewItem("万願寺とうがらし", data)).rejects.toThrow("injected failure at supply.create");
    expect(mem.state.items.map((i) => i.name)).toEqual(["トマト"]);
    expect(mem.state.varieties.map((v) => v.id)).toEqual(["v-tomato"]);
    expect(mem.state.supplies).toEqual([]);
  });
  it("品目の作成に失敗しても何も残らない", async () => {
    mem.failOn = "item.create";
    await expect(repo.createSupplyWithNewItem("万願寺とうがらし", data)).rejects.toThrow();
    expect(mem.state).toMatchObject({ items: [{ name: "トマト" }], supplies: [] });
    expect(mem.state.varieties).toHaveLength(1);
  });
  it("同時に同じ名前の品目が作られていた（一意制約）：その品目で出品する。同じ回の出品がすでにあれば null（今までどおり 409）", async () => {
    expect((await repo.createSupplyWithNewItem("トマト", data))?.item.name).toBe("トマト");
    expect(mem.state.items).toHaveLength(1);
    expect(mem.state.supplies).toMatchObject([{ itemId: "i-tomato", varietyId: "v-tomato" }]);
    expect(await repo.createSupplyWithNewItem("トマト", data)).toBeNull();
    expect(mem.state.supplies).toHaveLength(1);
  });
});
