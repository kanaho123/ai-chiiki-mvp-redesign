import { describe, expect, it } from "vitest";
import { GENERAL_ITEMS, GENERAL_SERIES, MATERIALIZE_DAYS, seedGeneralMaster } from "./general-master";

// 一般ユーザー向けのマスタ seed のテスト（メモリ上の表で確かめる。実 DB には接続しない）。
// SlotSeries.active=false の意味（MVP）：新しい受渡の回を作らない。すでに作った回・参加者は残す（削除・取り消ししない）。

type Slot = { id: string; seriesId: string; startAt: Date };
function fakeDb(opts: { inactive?: string[] } = {}) {
  const t = {
    items: [] as { id: string; name: string }[], varieties: [] as { itemId: string; name: string }[], places: [] as { id: string }[],
    series: new Map<string, { id: string; active: boolean }>(), slots: [] as Slot[],
    seriesParticipants: [] as { seriesId: string; producerId: string }[], slotParticipants: [] as { slotId: string; producerId: string }[],
  };
  for (const id of opts.inactive ?? []) t.series.set(id, { id, active: false });
  let seq = 0;
  const db = {
    item: { upsert: async ({ where }: { where: { name: string } }) => t.items.find((i) => i.name === where.name) ?? (t.items.push({ id: `i${++seq}`, name: where.name }), t.items.at(-1)!) },
    variety: { upsert: async ({ create }: { create: { itemId: string; name: string } }) => { if (!t.varieties.some((v) => v.itemId === create.itemId && v.name === create.name)) t.varieties.push(create); } },
    place: { upsert: async ({ where }: { where: { id: string } }) => { if (!t.places.some((p) => p.id === where.id)) t.places.push({ id: where.id }); } },
    // active は seed で上書きしない（運営が DB で切り替える）。新しく作るときだけ既定の true
    slotSeries: { upsert: async ({ where }: { where: { id: string } }) => { const s = t.series.get(where.id) ?? { id: where.id, active: true }; t.series.set(where.id, s); return { active: s.active }; } },
    slotSeriesParticipant: { findMany: async ({ where }: { where: { seriesId: string } }) => t.seriesParticipants.filter((p) => p.seriesId === where.seriesId) },
    handoverSlot: {
      findUnique: async ({ where }: { where: { seriesId_startAt: { seriesId: string; startAt: Date } } }) =>
        t.slots.find((s) => s.seriesId === where.seriesId_startAt.seriesId && s.startAt.getTime() === where.seriesId_startAt.startAt.getTime()) ?? null,
      create: async ({ data }: { data: { seriesId: string; startAt: Date } }) => { const s = { id: `slot${++seq}`, seriesId: data.seriesId, startAt: data.startAt }; t.slots.push(s); return { id: s.id }; },
    },
    slotParticipant: {
      createMany: async ({ data }: { data: { slotId: string; producerId: string }[] }) => {
        const fresh = data.filter((d) => !t.slotParticipants.some((x) => x.slotId === d.slotId && x.producerId === d.producerId));
        t.slotParticipants.push(...fresh);
        return { count: fresh.length };
      },
    },
  };
  return { t, db: db as unknown as Parameters<typeof seedGeneralMaster>[0] };
}

const NOW = new Date("2026-10-18T03:00:00Z"); // 10/18(日) 12:00 JST

describe("一般ユーザー向けのマスタ seed", () => {
  it("品目6・「指定なし」・拠点・定期枠3と、4週間分の回を作る。何度実行しても増えない", async () => {
    const { t, db } = fakeDb();
    const r1 = await seedGeneralMaster(db, NOW);
    expect(t.items.map((i) => i.name)).toEqual([...GENERAL_ITEMS]);
    expect(t.varieties.every((v) => v.name === "指定なし")).toBe(true);
    expect(r1).toMatchObject({ series: GENERAL_SERIES.length, inactiveSeries: 0, slotsCreated: 12 });
    expect(MATERIALIZE_DAYS).toBe(28);
    const r2 = await seedGeneralMaster(db, NOW);
    expect(r2.slotsCreated).toBe(0);
    expect(t.slots).toHaveLength(12);
  });
  it("active=false の定期枠は新しい回を作らない。すでに作った回・参加者は残す", async () => {
    const { t, db } = fakeDb();
    await seedGeneralMaster(db, NOW);
    const target = GENERAL_SERIES[0].id;
    t.seriesParticipants.push({ seriesId: target, producerId: "p-1" });
    await seedGeneralMaster(db, NOW); // 参加者を今ある回に加える
    const existing = t.slots.filter((s) => s.seriesId === target).map((s) => s.id);
    const joined = t.slotParticipants.filter((p) => existing.includes(p.slotId)).length;
    expect(joined).toBe(existing.length);

    t.series.get(target)!.active = false; // 運営が止める
    const later = new Date(NOW.getTime() + 14 * 86_400_000); // 2週間後に seed を実行
    const r = await seedGeneralMaster(db, later);
    expect(r.inactiveSeries).toBe(1);
    expect(t.slots.filter((s) => s.seriesId === target).map((s) => s.id)).toEqual(existing); // 新しい回は作られず、既存は残る
    expect(t.slotParticipants.filter((p) => existing.includes(p.slotId))).toHaveLength(joined);
    expect(t.seriesParticipants).toEqual([{ seriesId: target, producerId: "p-1" }]);
    // ほかの有効な定期枠は、引き続き先の回が作られる
    expect(r.slotsCreated).toBeGreaterThan(0);
    expect(t.series.get(target)!.active).toBe(false); // seed は active を戻さない
  });
});
