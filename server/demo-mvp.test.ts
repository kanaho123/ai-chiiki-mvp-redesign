import { describe, expect, it, vi } from "vitest";
import { seedMvpDemo } from "./demo-mvp";

// デモのリセット（seedMvpDemo）が消す順番。外部キー（RESTRICT）で止まらないよう、子の表から消す。
// 後から追加した表は、マイグレーション前のデモ用 DB には無いので、あるときだけ消す
function fakePrisma(tables: string[]) {
  const calls: string[] = [];
  const model = (name: string) => new Proxy({}, { get: (_t, method: string) => async () => { calls.push(`${name}.${method}`); return method === "findMany" ? [] : { count: 0 }; } });
  const tx = new Proxy({}, {
    get: (_t, key: string) => key === "$queryRawUnsafe" ? async () => tables.map((t) => ({ t })) : model(key),
  });
  return { calls, prisma: { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as never };
}

describe("デモのリセット：消す順番", () => {
  it("評価・いつもの農家・やり取り → 相談、いつもの受け渡し場所 → 場所の順に消す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, prisma } = fakePrisma(["usual_producers", "trade_reviews", "trade_messages", "producer_places"]);
    await seedMvpDemo(prisma, undefined);
    const deletes = calls.filter((c) => c.endsWith(".deleteMany"));
    expect(deletes.slice(0, 4)).toEqual(["usualProducer.deleteMany", "tradeReview.deleteMany", "tradeMessage.deleteMany", "approvalRequest.deleteMany"]);
    expect(deletes.indexOf("producerPlace.deleteMany")).toBeLessThan(deletes.indexOf("place.deleteMany"));
    expect(deletes.indexOf("producerPlace.deleteMany")).toBeGreaterThan(-1);
  });
  it("後から追加した表が無いデモ用 DB では、その表には触れない（今までと同じ順番）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, prisma } = fakePrisma([]);
    await seedMvpDemo(prisma, undefined);
    expect(calls.filter((c) => c.endsWith(".deleteMany"))).toEqual([
      "approvalRequest.deleteMany", "supply.deleteMany", "slotParticipant.deleteMany", "relationship.deleteMany", "handoverSlot.deleteMany",
      "place.deleteMany", "producer.deleteMany", "user.deleteMany", "variety.deleteMany", "item.deleteMany",
    ]);
  });
});
