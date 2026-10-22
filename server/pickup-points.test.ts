import { describe, expect, it } from "vitest";
import type { PrismaClient } from "./generated/prisma/client.js";
import { placeCandidates } from "./pickup-points.js";

// 「場所を教えてください」の候補：住所を見せるのは、運営の場所・自分が登録した場所・自分が参加している場所だけ
describe("場所の候補の住所", () => {
  it("ほかの生産者が登録した直売所などは名前と種類だけ（住所は空）。運営・自分・参加中の場所は住所あり", async () => {
    let where: unknown = null;
    const rows = [
      { id: "pl-umeda", name: "梅田エリア受渡所（仮）", address: "大阪市北区", kind: null, ownerProducerId: null, series: [], usedBy: [] },
      { id: "pl-mine", name: "自分の直売所", address: "大阪府堺市南区1-1", kind: "direct_store", ownerProducerId: "p-me", series: [], usedBy: [] },
      { id: "pl-joined", name: "参加中の集荷場", address: "大阪府堺市中区2-2", kind: "collection_point", ownerProducerId: "p-other", series: [{ id: "s-1" }], usedBy: [] },
      { id: "pl-used", name: "いつも使う直売所", address: "大阪府和泉市4-4", kind: "direct_store", ownerProducerId: "p-other", series: [], usedBy: [{ producerId: "p-me" }] },
      { id: "pl-other", name: "ほかの人の出荷先", address: "大阪府堺市北区3-3", kind: "shipping_destination", ownerProducerId: "p-other", series: [], usedBy: [] },
    ];
    const db = { place: { findMany: async (q: { where: unknown }) => { where = q.where; return rows; } } } as unknown as PrismaClient;
    const list = await placeCandidates(db, "p-me");
    expect(list).toEqual([
      { placeId: "pl-umeda", name: "梅田エリア受渡所（仮）", address: "大阪市北区", kind: null },
      { placeId: "pl-mine", name: "自分の直売所", address: "大阪府堺市南区1-1", kind: "direct_store" },
      { placeId: "pl-joined", name: "参加中の集荷場", address: "大阪府堺市中区2-2", kind: "collection_point" },
      { placeId: "pl-used", name: "いつも使う直売所", address: "大阪府和泉市4-4", kind: "direct_store" }, // いつもの場所にしている場所も住所あり
      { placeId: "pl-other", name: "ほかの人の出荷先", address: "", kind: "shipping_destination" },
    ]);
    // 候補に出すのは、運営の場所・自分の場所・ほかの人の直売所／集荷場／出荷先だけ（ほかの人の農園・その他は出さない）
    expect(where).toEqual({ OR: [{ ownerProducerId: null }, { ownerProducerId: "p-me" }, { kind: { in: ["direct_store", "collection_point", "shipping_destination"] } }] });
  });
});
