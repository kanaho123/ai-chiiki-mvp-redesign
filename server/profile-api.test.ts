import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Confirmation } from "../src/lib/approvals.js";

// マイページ（/api/profile）と下部ナビの件数（/api/inbox）のテスト。DB の代わりにメモリ上の表を使う（実 DB には接続しない）。
// 権限の確認（server/auth.ts）・入力の確認（src/lib/onboarding.ts）・更新処理（server/profile.ts）は本物を使う。

type User = { id: string; role: "restaurant" | "producer"; displayName: string; onboardedAt: Date | null };
type Row = Record<string, unknown> & { id: string; ownerUserId: string };
type State = {
  users: User[]; restaurants: Row[]; producers: Row[]; producerItems: { producerId: string; itemId: string }[];
  seriesParticipants: { seriesId: string; producerId: string }[]; slotParticipants: { slotId: string; producerId: string }[];
  items: { id: string; name: string }[]; slotSeries: { id: string; active: boolean; weekday: number; startTime: string; endTime: string; feeYen: number }[];
  handoverSlots: { id: string; seriesId: string; confirmDeadlineAt: Date }[]; approvals: Confirmation[];
};
const mem = vi.hoisted(() => ({ state: null as unknown as State, failOn: null as string | null }));

vi.mock("./db.js", () => {
  const fail = (op: string) => { if (mem.failOn === op) throw new Error(`injected ${op}`); };
  const client = () => {
    const s = mem.state;
    return {
      restaurant: {
        findUnique: async ({ where }: { where: { ownerUserId: string } }) => s.restaurants.find((r) => r.ownerUserId === where.ownerUserId) ?? null,
        updateMany: async ({ where, data }: { where: { ownerUserId: string }; data: Record<string, unknown> }) => {
          const r = s.restaurants.find((x) => x.ownerUserId === where.ownerUserId);
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        },
      },
      producer: {
        findUnique: async ({ where }: { where: { ownerUserId: string } }) => {
          const p = s.producers.find((x) => x.ownerUserId === where.ownerUserId);
          if (!p) return null;
          return {
            ...p, mainItems: s.producerItems.filter((x) => x.producerId === p.id).map((x) => ({ itemId: x.itemId })),
            seriesMemberships: s.seriesParticipants.filter((x) => x.producerId === p.id).map((x) => ({ seriesId: x.seriesId })),
          };
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { fail("producer.update"); Object.assign(s.producers.find((x) => x.id === where.id)!, data); },
      },
      producerItem: {
        deleteMany: async ({ where }: { where: { producerId: string } }) => { s.producerItems = s.producerItems.filter((x) => x.producerId !== where.producerId); },
        createMany: async ({ data }: { data: State["producerItems"] }) => { fail("producerItem.createMany"); s.producerItems.push(...data); },
      },
      slotSeriesParticipant: {
        deleteMany: async ({ where }: { where: { producerId: string; seriesId: { in: string[] } } }) => {
          s.seriesParticipants = s.seriesParticipants.filter((x) => !(x.producerId === where.producerId && where.seriesId.in.includes(x.seriesId)));
        },
        createMany: async ({ data }: { data: State["seriesParticipants"] }) => { s.seriesParticipants.push(...data); },
      },
      slotParticipant: { createMany: async ({ data }: { data: State["slotParticipants"] }) => { s.slotParticipants.push(...data.filter((d) => !s.slotParticipants.some((x) => x.slotId === d.slotId && x.producerId === d.producerId))); } },
      handoverSlot: {
        findMany: async ({ where }: { where: { seriesId: { in: string[] }; confirmDeadlineAt: { gt: Date } } }) =>
          s.handoverSlots.filter((h) => where.seriesId.in.includes(h.seriesId) && h.confirmDeadlineAt > where.confirmDeadlineAt.gt).map((h) => ({ id: h.id })),
      },
      item: { findMany: async ({ where }: { where?: { id?: { in: string[] } } }) => s.items.filter((i) => !where?.id || where.id.in.includes(i.id)) },
      slotSeries: {
        findMany: async ({ where }: { where: { id?: { in: string[] }; OR?: [{ active: boolean }, { id: { in: string[] } }] } }) =>
          s.slotSeries
            .filter((x) => (where.id ? where.id.in.includes(x.id) : true) && (where.OR ? x.active || where.OR[1].id.in.includes(x.id) : true))
            .map((x) => ({ ...x, place: { name: `${x.id}の受渡所（仮）`, address: "大阪市" } })),
      },
      user: { update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => { fail("user.update"); Object.assign(s.users.find((u) => u.id === where.id)!, data); } },
    };
  };
  const $transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = structuredClone(mem.state);
    try { return await fn(client()); } catch (e) { mem.state = snapshot; throw e; }
  };
  return { prisma: new Proxy({}, { get: (_t, k: string) => (k === "$transaction" ? $transaction : (client() as Record<string, unknown>)[k]) }) };
});

vi.mock("./repo.js", () => ({
  repo: {
    findSessionUser: async (id: string) => {
      const u = mem.state.users.find((x) => x.id === id);
      if (!u) return null;
      const p = mem.state.producers.find((x) => x.ownerUserId === id);
      return {
        id: u.id, role: u.role, displayName: u.displayName,
        producer: p ? { id: p.id, farmName: p.farmName as string, originPrefecture: p.originPrefecture as string } : null,
        onboarded: process.env.APP_MODE === "demo" || u.onboardedAt !== null,
      };
    },
  },
}));

// 依頼の一覧は本物（server/approvals.ts）が在庫を計算し直して状態を決める。ここではその結果だけを差し替える
vi.mock("./approvals.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./approvals.js")>();
  return {
    ...real,
    approvals: {
      ...real.approvals,
      list: async (user: { role: string; producer: { id: string } | null }) =>
        user.role === "producer" && user.producer ? mem.state.approvals.filter((a) => a.supplyId.startsWith(user.producer!.id)) : [],
    },
  };
});

process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghijklmnop";
const { createSessionToken } = await import("./auth.js");
const profileApi = await import("./routes/profile.js");
const inboxApi = await import("./routes/inbox.js");

const BASE = "http://localhost:5180";
const NOW = Date.now();
const cookieFor = (id: string, role: "restaurant" | "producer") => `aic_session=${createSessionToken({ id, role }, new Date())}`;
const R = cookieFor("u-r", "restaurant");
const P = cookieFor("u-p", "producer");
const get = (api: { GET: (r: Request) => Promise<Response> }, cookie?: string) => api.GET(new Request(`${BASE}/api`, { headers: cookie ? { cookie } : {} }));
const patch = (body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  profileApi.PATCH(new Request(`${BASE}/api/profile`, { method: "PATCH", headers: { "content-type": "application/json", ...(cookie && { cookie }), ...headers }, body: JSON.stringify(body) }));

const restaurantRow = (): Row => ({
  id: "r-1", ownerUserId: "u-r", name: "テスト食堂", businessType: "japanese", businessTypeOther: null, prefecture: "大阪府", city: "大阪市北区",
  address: null, phone: null, purchaseFrequency: "weekly", purchaseVolume: "small", irregularPolicy: "welcome", firstTimePolicy: "include",
  pickupTimes: ["morning"], priorities: ["local"],
});
const producerRow = (): Row => ({
  id: "p-1", ownerUserId: "u-p", farmName: "テスト農園", producerName: "山田", originPrefecture: "大阪府", city: "堺市", otherCrops: null,
  productionStyle: "many_small", salesChannels: ["direct_store"], directTradeExperience: "sometimes", capabilities: ["small_lot"],
  contactPhone: "090-0000-0000", contactEmail: null,
});
const reqRow = (id: string, status: Confirmation["status"]): Confirmation => ({
  id, supplyId: `p-1:${id}`, producerName: "テスト農園", restaurantName: "テスト食堂", planFingerprint: id, itemName: "トマト", quantityKg: 5,
  priceYenPerKg: 600, subtotalYen: 3000, pickupStartAt: "2026-10-23T01:00:00.000Z", pickupEndAt: "2026-10-23T02:00:00.000Z", pickupPlace: "P", status, createdAt: "2026-10-20T00:00:00.000Z",
});

beforeEach(() => {
  vi.stubEnv("APP_MODE", "general");
  mem.failOn = null;
  mem.state = {
    users: [
      { id: "u-r", role: "restaurant", displayName: "テスト食堂", onboardedAt: new Date() },
      { id: "u-p", role: "producer", displayName: "テスト農園", onboardedAt: new Date() },
      { id: "u-new", role: "restaurant", displayName: "（未設定）", onboardedAt: null },
      { id: "u-p2", role: "producer", displayName: "別の農園", onboardedAt: new Date() },
    ],
    restaurants: [restaurantRow()],
    producers: [producerRow(), { ...producerRow(), id: "p-2", ownerUserId: "u-p2", farmName: "別の農園" }],
    producerItems: [{ producerId: "p-1", itemId: "i-tomato" }, { producerId: "p-2", itemId: "i-tomato" }],
    seriesParticipants: [{ seriesId: "s-old", producerId: "p-1" }, { seriesId: "s-a", producerId: "p-2" }],
    slotParticipants: [{ slotId: "slot-old-1", producerId: "p-1" }],
    items: [{ id: "i-tomato", name: "トマト" }, { id: "i-onion", name: "玉ねぎ" }],
    slotSeries: [
      { id: "s-a", active: true, weekday: 2, startTime: "10:00", endTime: "11:00", feeYen: 800 },
      { id: "s-b", active: true, weekday: 3, startTime: "14:00", endTime: "15:00", feeYen: 800 },
      { id: "s-old", active: false, weekday: 5, startTime: "10:00", endTime: "11:00", feeYen: 800 }, // 止めたが、p-1 は参加中
      { id: "s-off", active: false, weekday: 6, startTime: "10:00", endTime: "11:00", feeYen: 800 },
    ],
    handoverSlots: [
      { id: "slot-b-past", seriesId: "s-b", confirmDeadlineAt: new Date(NOW - 3600_000) },
      { id: "slot-b-next", seriesId: "s-b", confirmDeadlineAt: new Date(NOW + 3600_000) },
      { id: "slot-old-1", seriesId: "s-old", confirmDeadlineAt: new Date(NOW + 7200_000) },
    ],
    approvals: [],
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("マイページの表示", () => {
  it("飲食店：本人のプロフィールを返す", async () => {
    const res = await get(profileApi, R);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.role).toBe("restaurant");
    expect(d.profile).toMatchObject({ name: "テスト食堂", businessType: "japanese", address: "", phone: "", pickupTimes: ["morning"], priorities: ["local"] });
  });
  it("生産者：主な作物・参加中の受渡枠（止めた枠でも参加中なら出す）・連絡先。参加していない止めた枠は出さない", async () => {
    const d = await (await get(profileApi, P)).json();
    expect(d.profile).toMatchObject({ farmName: "テスト農園", itemIds: ["i-tomato"], seriesIds: ["s-old"], contactPhone: "090-0000-0000", contactEmail: "" });
    expect(d.series.map((s: { id: string; active: boolean }) => `${s.id}:${s.active}`)).toEqual(["s-a:true", "s-b:true", "s-old:false"]);
    expect(d.items).toHaveLength(2);
  });
  it("未ログイン 401・登録前 403・demo mode 404", async () => {
    expect((await get(profileApi)).status).toBe(401);
    const pre = await get(profileApi, cookieFor("u-new", "restaurant"));
    expect(pre.status).toBe(403);
    expect((await pre.json()).code).toBe("onboarding-required");
    vi.stubEnv("APP_MODE", "demo");
    expect((await get(profileApi, R)).status).toBe(404);
  });
});

describe("飲食店のプロフィール更新", () => {
  it("本人のプロフィールを更新し、表示名も店舗名にそろえる。送られた ID・ownerUserId は使わない", async () => {
    const body = { ...(await (await get(profileApi, R)).json()).profile, name: " 新しい食堂 ", address: "大阪市北区1-1", priorities: [], ownerUserId: "u-p", id: "r-x" };
    const res = await patch(body, R);
    expect(res.status).toBe(200);
    expect((await res.json()).user.displayName).toBe("新しい食堂");
    expect(mem.state.restaurants).toHaveLength(1);
    expect(mem.state.restaurants[0]).toMatchObject({ id: "r-1", ownerUserId: "u-r", name: "新しい食堂", address: "大阪市北区1-1", priorities: [] });
  });
  it.each([
    ["業態が選択肢にない", { businessType: "sushi" }, "businessType"],
    ["大切にしたいことが4つ", { priorities: ["local", "price", "freshness", "rare_items"] }, "priorities"],
    ["その他なのに内容なし", { businessType: "other", businessTypeOther: "" }, "businessTypeOther"],
    ["店舗名が空", { name: "" }, "name"],
  ])("%s → 400・変更しない", async (_l, over, field) => {
    const res = await patch({ ...(await (await get(profileApi, R)).json()).profile, ...over }, R);
    expect(res.status).toBe(400);
    expect((await res.json()).errors[field]).toBeTruthy();
    expect(mem.state.restaurants[0]).toMatchObject(restaurantRow());
  });
});

describe("生産者のプロフィール更新", () => {
  const current = async () => (await (await get(profileApi, P)).json()).profile;
  it("作物・受渡枠を変更：新しく選んだ枠はこれからの回にも参加。前から参加している枠は外さない（古い内容で保存しても消えない）", async () => {
    const res = await patch({ ...(await current()), farmName: "みどり農園", itemIds: ["i-onion"], seriesIds: ["s-b"], contactEmail: "farm@example.com" }, P);
    expect(res.status).toBe(200);
    expect(mem.state.producers[0]).toMatchObject({ farmName: "みどり農園", contactEmail: "farm@example.com", ownerUserId: "u-p" });
    expect(mem.state.producerItems.filter((x) => x.producerId === "p-1")).toEqual([{ producerId: "p-1", itemId: "i-onion" }]);
    expect(mem.state.seriesParticipants.filter((x) => x.producerId === "p-1").map((x) => x.seriesId).sort()).toEqual(["s-b", "s-old"]);
    expect(mem.state.slotParticipants.filter((x) => x.producerId === "p-1").map((x) => x.slotId).sort()).toEqual(["slot-b-next", "slot-old-1"]);
    expect(mem.state.users.find((u) => u.id === "u-p")!.displayName).toBe("みどり農園");
    // ほかの生産者のデータは変わらない
    expect(mem.state.producers[1]).toMatchObject({ farmName: "別の農園" });
    expect(mem.state.seriesParticipants.filter((x) => x.producerId === "p-2")).toEqual([{ seriesId: "s-a", producerId: "p-2" }]);
  });
  it("受け渡しの場所がなくても保存できる。参加はそのまま", async () => {
    expect((await patch({ ...(await current()), seriesIds: [] }, P)).status).toBe(200);
    expect(mem.state.seriesParticipants.filter((x) => x.producerId === "p-1").map((x) => x.seriesId)).toEqual(["s-old"]);
  });
  it("止めた枠でも、参加中ならそのまま残せる", async () => {
    expect((await patch({ ...(await current()), seriesIds: ["s-old", "s-a"] }, P)).status).toBe(200);
    expect(mem.state.seriesParticipants.filter((x) => x.producerId === "p-1").map((x) => x.seriesId).sort()).toEqual(["s-a", "s-old"]);
  });
  it.each([
    ["止めた枠に新しく参加", { seriesIds: ["s-off"] }, "seriesIds"],
    ["存在しない枠", { seriesIds: ["s-x"] }, "seriesIds"],
    ["品目マスタにない作物", { itemIds: ["i-x"] }, "itemIds"],
    ["作物が空", { itemIds: [] }, "itemIds"],
    ["連絡先をどちらも消す", { contactPhone: "", contactEmail: "" }, "contactPhone"],
    ["メールの形式", { contactEmail: "farm@" }, "contactEmail"],
  ])("%s → 400・変更しない", async (_l, over, field) => {
    const before = structuredClone(mem.state);
    const res = await patch({ ...(await current()), ...over }, P);
    expect(res.status).toBe(400);
    expect((await res.json()).errors[field]).toBeTruthy();
    expect(mem.state).toEqual(before);
  });
  it("途中で失敗したら何も変えない（transaction）", async () => {
    mem.failOn = "user.update";
    const before = structuredClone(mem.state);
    expect((await patch({ ...(await current()), farmName: "変更", itemIds: ["i-onion"] }, P)).status).toBe(500);
    expect(mem.state).toEqual(before);
  });
});

describe("権限", () => {
  it("未ログイン 401・登録前 403・別サイトからの送信 403", async () => {
    expect((await patch(restaurantRow())).status).toBe(401);
    expect((await patch(restaurantRow(), cookieFor("u-new", "restaurant"))).status).toBe(403);
    expect((await patch(restaurantRow(), R, { origin: "https://evil.example" })).status).toBe(403);
  });
  it("ロールに合わない内容は、そのロールの確認で拒否する（飲食店が生産者の内容を送る）", async () => {
    const res = await patch({ ...producerRow(), itemIds: ["i-tomato"], seriesIds: ["s-a"], prefecture: "大阪府" }, R);
    expect(res.status).toBe(400);
    expect(mem.state.restaurants[0]).toMatchObject(restaurantRow());
    expect(mem.state.producers[0]).toMatchObject(producerRow());
  });
});

describe("下部ナビの件数（/api/inbox）", () => {
  it.each([
    [[], 0], [["pending"], 1], [["pending", "pending", "approved", "rejected", "stale"], 2],
  ] as const)("生産者：%j → %i 件（返事が必要なものだけ）", async (statuses, want) => {
    mem.state.approvals = statuses.map((st, i) => reqRow(`q${i}`, st));
    const res = await get(inboxApi, P);
    expect(res.status).toBe(200);
    expect((await res.json()).producerRequests).toBe(want);
  });
  it("ほかの生産者の依頼は数えない", async () => {
    mem.state.approvals = [{ ...reqRow("x", "pending"), supplyId: "p-2:x" }];
    expect((await (await get(inboxApi, P)).json()).producerRequests).toBe(0);
  });
  it("飲食店は件数を出さない（0）・未ログイン 401・登録前 403", async () => {
    expect((await (await get(inboxApi, R)).json()).producerRequests).toBe(0);
    expect((await get(inboxApi)).status).toBe(401);
    expect((await get(inboxApi, cookieFor("u-new", "restaurant"))).status).toBe(403);
  });
});
