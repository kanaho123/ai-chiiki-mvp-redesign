import { describe, expect, it } from "vitest";
import { ensureUpcomingSlots, GENERAL_ITEMS, GENERAL_SERIES, MATERIALIZE_DAYS, REFILL_WHEN_DAYS_LEFT, seedGeneralMaster, shortPlaceName } from "./general-master";
import { jstDateOf } from "./service-time";

// 一般ユーザー向けのマスタ seed と、受渡の回の補充のテスト（メモリ上の表で確かめる。実 DB には接続しない）。
// SlotSeries.active=false の意味（MVP）：新しい受渡の回を作らない。すでに作った回・参加者は残す（削除・取り消ししない）。

type Slot = { id: string; seriesId: string; placeId: string; label: string; startAt: Date; endAt: Date; confirmDeadlineAt: Date; feeYen: number };
type Series = { id: string; placeId: string; label: string; weekday: number; startTime: string; endTime: string; deadlineHours: number; feeYen: number; maxKg: number; active: boolean };
function fakeDb() {
  const t = {
    items: [] as { id: string; name: string }[], varieties: [] as { itemId: string; name: string }[], places: [] as { id: string; name: string }[],
    series: new Map<string, Series>(), slots: [] as Slot[],
    seriesParticipants: [] as { seriesId: string; producerId: string }[], slotParticipants: [] as { slotId: string; producerId: string }[],
  };
  let seq = 0;
  const tick = () => new Promise((r) => setTimeout(r, 0)); // 同時実行の確認用（処理の途中で順番が入れ替わる）
  const db = {
    item: { upsert: async ({ where }: { where: { name: string } }) => t.items.find((i) => i.name === where.name) ?? (t.items.push({ id: `i${++seq}`, name: where.name }), t.items.at(-1)!) },
    variety: { upsert: async ({ create }: { create: { itemId: string; name: string } }) => { if (!t.varieties.some((v) => v.itemId === create.itemId && v.name === create.name)) t.varieties.push(create); } },
    place: { upsert: async ({ where, create }: { where: { id: string }; create: { id: string; name: string } }) => { if (!t.places.some((p) => p.id === where.id)) t.places.push({ id: create.id, name: create.name }); } },
    // active は seed で上書きしない（運営が DB で切り替える）。新しく作るときだけ既定の true
    slotSeries: {
      upsert: async ({ where, create }: { where: { id: string }; create: Omit<Series, "active"> }) => {
        const s = t.series.get(where.id) ?? { ...create, active: true };
        t.series.set(where.id, s);
        return { active: s.active };
      },
      findMany: async ({ where }: { where: { active: boolean } }) => [...t.series.values()].filter((s) => s.active === where.active).map((s) => ({
        ...s, place: { name: t.places.find((p) => p.id === s.placeId)?.name ?? "" },
        slots: t.slots.filter((x) => x.seriesId === s.id).sort((a, b) => b.startAt.getTime() - a.startAt.getTime()).slice(0, 1).map((x) => ({ startAt: x.startAt })),
        participants: t.seriesParticipants.filter((p) => p.seriesId === s.id).map((p) => ({ producerId: p.producerId })),
      })),
    },
    handoverSlot: {
      // 本物と同じく（seriesId, startAt）は一意。skipDuplicates で既存の回はそのまま
      createMany: async ({ data }: { data: Omit<Slot, "id">[] }) => {
        await tick();
        let count = 0;
        for (const d of data) {
          if (t.slots.some((s) => s.seriesId === d.seriesId && s.startAt.getTime() === d.startAt.getTime())) continue;
          t.slots.push({ ...d, id: `slot${++seq}` });
          count++;
        }
        return { count };
      },
      findMany: async ({ where }: { where: { seriesId: string; startAt: { in: Date[] } } }) =>
        t.slots.filter((s) => s.seriesId === where.seriesId && where.startAt.in.some((d) => d.getTime() === s.startAt.getTime())).map((s) => ({ id: s.id })),
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
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const snapshot = (t: ReturnType<typeof fakeDb>["t"]) => JSON.stringify({ slots: t.slots, sp: t.slotParticipants });

describe("一般ユーザー向けのマスタ seed", () => {
  it("品目6・「指定なし」・拠点・定期枠3と、4週間分の回を作る。何度実行しても増えない", async () => {
    const { t, db } = fakeDb();
    const r1 = await seedGeneralMaster(db, NOW);
    expect(t.items.map((i) => i.name)).toEqual([...GENERAL_ITEMS]);
    expect(t.varieties.every((v) => v.name === "指定なし")).toBe(true);
    expect(r1).toMatchObject({ series: GENERAL_SERIES.length, inactiveSeries: 0, slotsCreated: 12 });
    expect(MATERIALIZE_DAYS).toBe(28);
    expect(t.slots.map((s) => s.label)).toContain("梅田・火10:00");
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
    const r = await seedGeneralMaster(db, days(14)); // 2週間後に seed を実行
    expect(r.inactiveSeries).toBe(1);
    expect(t.slots.filter((s) => s.seriesId === target).map((s) => s.id)).toEqual(existing); // 新しい回は作られず、既存は残る
    expect(t.slotParticipants.filter((p) => existing.includes(p.slotId))).toHaveLength(joined);
    expect(t.seriesParticipants).toEqual([{ seriesId: target, producerId: "p-1" }]);
    expect(r.slotsCreated).toBeGreaterThan(0); // ほかの有効な定期枠は、引き続き先の回が作られる
    expect(t.series.get(target)!.active).toBe(false); // seed は active を戻さない
  });
});

describe("受渡の回の補充（ensureUpcomingSlots）", () => {
  it("最後の回がまだ先なら何もしない。近づいたら4週間先まで補充する（既存の回は変えない）", async () => {
    const { t, db } = fakeDb();
    await seedGeneralMaster(db, NOW); // 10/20〜11/13 の12回
    const before = snapshot(t);
    expect(await ensureUpcomingSlots(db, NOW)).toMatchObject({ activeSeries: 3, refilledSeries: 0, slotsCreated: 0 });
    expect(snapshot(t)).toBe(before);
    // 最後の回（11/13）まで21日を切る日：10/24 以降
    const later = days(7); // 10/25
    expect(t.slots.every((s) => s.startAt.getTime() > later.getTime() + REFILL_WHEN_DAYS_LEFT * 86_400_000)).toBe(false);
    const r = await ensureUpcomingSlots(db, later);
    expect(r.refilledSeries).toBe(3);
    expect(r.slotsCreated).toBeGreaterThan(0);
    const maxStart = Math.max(...t.slots.map((s) => s.startAt.getTime()));
    expect(maxStart).toBeGreaterThan(later.getTime() + 21 * 86_400_000);
    expect(maxStart).toBeLessThanOrEqual(later.getTime() + 29 * 86_400_000);
    // 元の12回は1件も変わっていない
    const old = JSON.parse(before).slots as Slot[];
    for (const o of old) expect(JSON.stringify(t.slots.find((s) => s.id === o.id))).toBe(JSON.stringify(o));
  });
  it("何度実行しても・同時に実行しても、同じ定期枠・開始時刻の回は1つだけ", async () => {
    const { t, db } = fakeDb();
    await seedGeneralMaster(db, NOW);
    const later = days(30);
    await Promise.all([ensureUpcomingSlots(db, later), ensureUpcomingSlots(db, later), ensureUpcomingSlots(db, later, { force: true })]);
    await ensureUpcomingSlots(db, later);
    const keys = t.slots.map((s) => `${s.seriesId}@${s.startAt.toISOString()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("active=false の定期枠からは作らない。定期枠の参加者は新しい回にも加わり、既存の参加は消えない", async () => {
    const { t, db } = fakeDb();
    await seedGeneralMaster(db, NOW);
    const [a, b] = GENERAL_SERIES;
    t.seriesParticipants.push({ seriesId: a.id, producerId: "p-1" });
    t.slotParticipants.push({ slotId: t.slots.find((s) => s.seriesId === b.id)!.id, producerId: "p-9" }); // 個別に入っている参加
    t.series.get(b.id)!.active = false;
    const bSlots = t.slots.filter((s) => s.seriesId === b.id).length;
    const later = days(40);
    await ensureUpcomingSlots(db, later);
    expect(t.slots.filter((s) => s.seriesId === b.id)).toHaveLength(bSlots);
    const newA = t.slots.filter((s) => s.seriesId === a.id && s.startAt > later);
    expect(newA.length).toBeGreaterThan(0);
    for (const s of newA) expect(t.slotParticipants).toContainEqual(expect.objectContaining({ slotId: s.id, producerId: "p-1" }));
    expect(t.slotParticipants.filter((p) => p.producerId === "p-9")).toHaveLength(1);
  });
  it("曜日・時刻は日本時間で作る（UTC の日付がずれても曜日はそのまま）", async () => {
    const { t, db } = fakeDb();
    await seedGeneralMaster(db, NOW);
    for (const s of t.slots) {
      const series = GENERAL_SERIES.find((x) => x.id === s.seriesId)!;
      expect(jstDateOf(s.startAt).weekday).toBe(series.weekday);
      const jst = new Date(s.startAt.getTime() + 9 * 3600_000);
      expect(`${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`).toBe(series.startTime);
    }
  });
  it("拠点の短い名前", () => {
    expect(shortPlaceName("梅田エリア受渡所（仮）")).toBe("梅田");
    expect(shortPlaceName("天王寺エリア受渡所（仮）")).toBe("天王寺");
    expect(shortPlaceName("受渡拠点P")).toBe("受渡拠点P");
  });
});
