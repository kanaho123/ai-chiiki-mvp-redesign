import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 初回登録（オンボーディング）API のテスト。DB の代わりにメモリ上の表を使う（実 DB には接続しない）。
// transaction は本物と同じく「1つずつ順に実行し、途中で失敗したら全部取り消す」ようにしてある。
// 権限の確認（server/auth.ts）・入力の確認・登録処理（server/onboarding.ts）は本物を使う。

type User = { id: string; role: "restaurant" | "producer"; displayName: string; onboardedAt: Date | null };
type State = {
  users: User[]; restaurants: Record<string, unknown>[]; producers: Record<string, unknown>[];
  producerItems: { producerId: string; itemId: string }[]; seriesParticipants: { seriesId: string; producerId: string }[];
  slotParticipants: { slotId: string; producerId: string; confirmed: boolean }[];
  items: { id: string; name: string }[];
  slotSeries: { id: string; active: boolean; weekday: number; startTime: string; endTime: string; feeYen: number; maxKg: number; deadlineHours: number; placeId: string }[];
  places: { id: string; name: string; address: string }[];
  handoverSlots: { id: string; seriesId: string | null; confirmDeadlineAt: Date }[];
};
const mem = vi.hoisted(() => ({ state: null as unknown as State, failOn: null as string | null, seq: 0, lock: Promise.resolve() as Promise<unknown> }));

vi.mock("./db.js", () => {
  const uniqueError = () => Object.assign(new Error("Unique constraint failed"), { name: "PrismaClientKnownRequestError", code: "P2002" });
  const maybeFail = (op: string) => { if (mem.failOn === op) throw new Error(`injected failure at ${op}`); };
  const inIds = (where: { id?: { in?: string[] } } | undefined) => where?.id?.in;
  const client = () => {
    const s = mem.state;
    return {
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const u = s.users.find((x) => x.id === where.id);
          if (!u) return null;
          const r = s.restaurants.find((x) => x.ownerUserId === u.id);
          const p = s.producers.find((x) => x.ownerUserId === u.id);
          return { role: u.role, onboardedAt: u.onboardedAt, restaurant: r ? { id: r.id } : null, producer: p ? { id: p.id } : null };
        },
        updateMany: async ({ where, data }: { where: { id: string; onboardedAt: null }; data: Partial<User> }) => {
          maybeFail("user.updateMany");
          const u = s.users.find((x) => x.id === where.id && x.onboardedAt === null);
          if (!u) return { count: 0 };
          Object.assign(u, data);
          return { count: 1 };
        },
      },
      restaurant: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          maybeFail("restaurant.create");
          if (s.restaurants.some((x) => x.ownerUserId === data.ownerUserId)) throw uniqueError();
          const row = { id: `r-${++mem.seq}`, ...data };
          s.restaurants.push(row);
          return row;
        },
      },
      producer: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          maybeFail("producer.create");
          if (s.producers.some((x) => x.ownerUserId === data.ownerUserId)) throw uniqueError();
          const row = { id: `p-${++mem.seq}`, ...data };
          s.producers.push(row);
          return { id: row.id };
        },
      },
      producerItem: { createMany: async ({ data }: { data: State["producerItems"] }) => { maybeFail("producerItem.createMany"); s.producerItems.push(...data); return { count: data.length }; } },
      slotSeriesParticipant: { createMany: async ({ data }: { data: State["seriesParticipants"] }) => { maybeFail("slotSeriesParticipant.createMany"); s.seriesParticipants.push(...data); return { count: data.length }; } },
      slotParticipant: {
        createMany: async ({ data }: { data: State["slotParticipants"] }) => {
          const fresh = data.filter((d) => !s.slotParticipants.some((x) => x.slotId === d.slotId && x.producerId === d.producerId));
          s.slotParticipants.push(...fresh);
          return { count: fresh.length };
        },
      },
      item: {
        findMany: async ({ where }: { where?: { id?: { in?: string[] } } }) => {
          const ids = inIds(where);
          return s.items.filter((i) => !ids || ids.includes(i.id)).map((i) => ({ id: i.id, name: i.name }));
        },
      },
      slotSeries: {
        findMany: async ({ where }: { where: { id?: { in?: string[] }; active?: boolean } }) => {
          const ids = inIds(where);
          return s.slotSeries.filter((x) => (!ids || ids.includes(x.id)) && (where.active === undefined || x.active === where.active))
            .map((x) => ({ ...x, place: s.places.find((p) => p.id === x.placeId)! }));
        },
      },
      handoverSlot: {
        findMany: async ({ where }: { where: { seriesId: { in: string[] }; confirmDeadlineAt: { gt: Date } } }) =>
          s.handoverSlots.filter((h) => h.seriesId && where.seriesId.in.includes(h.seriesId) && h.confirmDeadlineAt > where.confirmDeadlineAt.gt).map((h) => ({ id: h.id })),
      },
      approvalRequest: { findMany: async () => [] },
    };
  };
  const prisma = {
    ...client(),
    // 本物の DB と同じく、transaction は1つずつ実行し、例外なら中身をすべて取り消す
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      const run = mem.lock.then(async () => {
        const snapshot = structuredClone(mem.state);
        try {
          return await fn(client());
        } catch (e) {
          mem.state = snapshot;
          throw e;
        }
      });
      mem.lock = run.catch(() => {});
      return run;
    },
  };
  // item / slotSeries は transaction の外（マスタ API）でも使う
  return { prisma: new Proxy(prisma, { get: (t, k: string) => (k === "$transaction" ? t.$transaction : (client() as Record<string, unknown>)[k]) }) };
});

vi.mock("./repo.js", () => ({
  repo: {
    findSessionUser: async (id: string) => {
      const u = mem.state.users.find((x) => x.id === id);
      if (!u) return null;
      const p = mem.state.producers.find((x) => x.ownerUserId === id);
      return {
        id: u.id, role: u.role, displayName: u.displayName,
        producer: p ? { id: p.id as string, farmName: p.farmName as string, originPrefecture: p.originPrefecture as string } : null,
        onboarded: process.env.APP_MODE === "demo" || u.onboardedAt !== null,
      };
    },
    listOwnSupplies: async () => [],
    producerSlots: async (producerId: string) => mem.state.slotParticipants.filter((x) => x.producerId === producerId).map((x) => ({ id: x.slotId })),
    itemsWithVarieties: async () => [],
  },
}));

process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghijklmnop";
const { createSessionToken } = await import("./auth.js");
const restaurantApi = await import("./routes/onboarding/restaurant.js");
const producerApi = await import("./routes/onboarding/producer.js");
const masterApi = await import("./routes/onboarding/master.js");
const supplies = await import("./routes/supplies/index.js");
const approvals = await import("./routes/approvals/index.js");

const BASE = "http://localhost:5180";
const NOW = new Date();
const later = (h: number) => new Date(NOW.getTime() + h * 3600_000);
const cookieFor = (id: string, role: "restaurant" | "producer") => `aic_session=${createSessionToken({ id, role }, new Date())}`;
const post = (api: { POST: (r: Request) => Promise<Response> }, body: unknown, cookie?: string) =>
  api.POST(new Request(`${BASE}/api`, { method: "POST", headers: { "content-type": "application/json", ...(cookie && { cookie }) }, body: JSON.stringify(body) }));
const get = (api: { GET: (r: Request) => Promise<Response> }, cookie?: string) => api.GET(new Request(`${BASE}/api`, { headers: cookie ? { cookie } : {} }));

const R = cookieFor("u-r", "restaurant");
const P = cookieFor("u-p", "producer");
const restaurantBody = (over: Record<string, unknown> = {}) => ({
  name: "  テスト食堂 ", businessType: "japanese", businessTypeOther: "", prefecture: "大阪府", city: "大阪市北区", address: "", phone: "",
  purchaseFrequency: "few_times_weekly", purchaseVolume: "small", irregularPolicy: "welcome", firstTimePolicy: "include",
  pickupTimes: ["morning", "morning"], priorities: ["local", "freshness"], ...over,
});
const producerBody = (over: Record<string, unknown> = {}) => ({
  farmName: " テスト農園 ", producerName: "山田 花子", prefecture: "大阪府", city: "堺市南区", itemIds: ["item-tomato", "item-tomato", "item-eggplant"],
  otherCrops: "", productionStyle: "many_small", salesChannels: ["direct_store", "restaurant"], directTradeExperience: "sometimes",
  capabilities: ["small_lot", "irregular"], seriesIds: ["series-a"], contactPhone: "090-1234-5678", contactEmail: "", ...over,
});
const userOf = (id: string) => mem.state.users.find((u) => u.id === id)!;

beforeEach(() => {
  vi.stubEnv("APP_MODE", "general");
  mem.failOn = null;
  mem.state = {
    users: [
      { id: "u-r", role: "restaurant", displayName: "（未設定）", onboardedAt: null },
      { id: "u-p", role: "producer", displayName: "（未設定）", onboardedAt: null },
    ],
    restaurants: [], producers: [], producerItems: [], seriesParticipants: [], slotParticipants: [],
    items: [{ id: "item-tomato", name: "トマト" }, { id: "item-eggplant", name: "なす" }],
    places: [{ id: "place-a", name: "梅田エリア受渡所（仮）", address: "大阪市北区" }],
    slotSeries: [
      { id: "series-a", active: true, weekday: 2, startTime: "10:00", endTime: "11:00", feeYen: 800, maxKg: 20, deadlineHours: 17, placeId: "place-a" },
      { id: "series-off", active: false, weekday: 4, startTime: "10:00", endTime: "11:00", feeYen: 800, maxKg: 20, deadlineHours: 17, placeId: "place-a" },
    ],
    handoverSlots: [
      { id: "slot-past", seriesId: "series-a", confirmDeadlineAt: later(-24) },
      { id: "slot-next", seriesId: "series-a", confirmDeadlineAt: later(24) },
      { id: "slot-next2", seriesId: "series-a", confirmDeadlineAt: later(24 * 8) },
    ],
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("飲食店の初回登録", () => {
  it("正常に完了：プロフィールを作り、登録済み・表示名を店舗名にする（値は正規化）", async () => {
    const res = await post(restaurantApi, restaurantBody({ businessTypeOther: "使わない値", onboardedAt: "2000-01-01", ownerUserId: "u-p", id: "x" }), R);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.user).toMatchObject({ id: "u-r", onboarded: true, displayName: "テスト食堂" });
    expect(mem.state.restaurants).toHaveLength(1);
    expect(mem.state.restaurants[0]).toMatchObject({
      ownerUserId: "u-r", name: "テスト食堂", businessType: "japanese", businessTypeOther: null, address: null, phone: null,
      pickupTimes: ["morning"], priorities: ["local", "freshness"],
    });
    expect(mem.state.restaurants[0].id).not.toBe("x");
    expect(userOf("u-r").onboardedAt).toBeInstanceOf(Date);
    expect(userOf("u-r").onboardedAt!.getFullYear()).not.toBe(2000);
  });
  it("受け取りの時間帯・大切にしたいことは選ばなくても登録でき、空の配列で保存する", async () => {
    const res = await post(restaurantApi, restaurantBody({ pickupTimes: [], priorities: undefined }), R);
    expect(res.status).toBe(200);
    expect(mem.state.restaurants[0]).toMatchObject({ pickupTimes: [], priorities: [] });
    expect(userOf("u-r").onboardedAt).toBeInstanceOf(Date);
  });
  it("業態「その他」のときだけ、その内容を保存する", async () => {
    const ng = await post(restaurantApi, restaurantBody({ businessType: "other", businessTypeOther: " " }), R);
    expect(ng.status).toBe(400);
    expect((await ng.json()).errors.businessTypeOther).toBeTruthy();
    const ok = await post(restaurantApi, restaurantBody({ businessType: "other", businessTypeOther: " 定食屋 " }), R);
    expect(ok.status).toBe(200);
    expect(mem.state.restaurants[0]).toMatchObject({ businessType: "other", businessTypeOther: "定食屋" });
  });
  it.each([
    ["業態が選択肢にない", { businessType: "sushi" }, "businessType"],
    ["頻度が選択肢にない", { purchaseFrequency: "monthly" }, "purchaseFrequency"],
    ["大切にしたいことが4つ", { priorities: ["local", "freshness", "price", "rare_items"] }, "priorities"],
    ["大切にしたいことに選択肢にない値", { priorities: ["local", "cheap"] }, "priorities"],
    ["受け取り「特にこだわらない」と時間帯を同時に", { pickupTimes: ["any", "morning"] }, "pickupTimes"],
    ["店舗名が空", { name: "   " }, "name"],
    ["店舗名が長すぎる", { name: "あ".repeat(61) }, "name"],
    ["都道府県が一覧にない", { prefecture: "大阪" }, "prefecture"],
    ["市区町村が空", { city: "" }, "city"],
    ["住所が長すぎる", { address: "あ".repeat(121) }, "address"],
    ["電話番号の形式", { phone: "でんわ" }, "phone"],
    ["配列でない", { priorities: "local" }, "priorities"],
  ])("%s → 400（errors.%s）・何も保存しない", async (_label, over, field) => {
    const res = await post(restaurantApi, restaurantBody(over), R);
    expect(res.status).toBe(400);
    expect((await res.json()).errors[field as string]).toBeTruthy();
    expect(mem.state.restaurants).toHaveLength(0);
    expect(userOf("u-r").onboardedAt).toBeNull();
  });
});

describe("生産者の初回登録", () => {
  it("正常に完了：プロフィール・主な作物・受渡枠・これからの受渡の回・連絡先・登録済み・表示名", async () => {
    const res = await post(producerApi, producerBody(), P);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.user).toMatchObject({ id: "u-p", onboarded: true, displayName: "テスト農園", producer: { farmName: "テスト農園", originPrefecture: "大阪府" } });
    const p = mem.state.producers[0];
    expect(p).toMatchObject({
      ownerUserId: "u-p", farmName: "テスト農園", producerName: "山田 花子", originPrefecture: "大阪府", city: "堺市南区", otherCrops: null,
      productionStyle: "many_small", salesChannels: ["direct_store", "restaurant"], directTradeExperience: "sometimes", capabilities: ["small_lot", "irregular"],
      contactPhone: "090-1234-5678", contactEmail: null,
    });
    expect(mem.state.producerItems.map((x) => x.itemId)).toEqual(["item-tomato", "item-eggplant"]); // 重複は1つに
    expect(mem.state.seriesParticipants).toEqual([{ seriesId: "series-a", producerId: p.id }]);
    expect(mem.state.slotParticipants.map((x) => x.slotId).sort()).toEqual(["slot-next", "slot-next2"]); // 締切を過ぎた回には加えない
    expect(userOf("u-p").onboardedAt).toBeInstanceOf(Date);
  });
  it.each([
    ["品目マスタにない ID", { itemIds: ["item-tomato", "item-nothing"] }, "itemIds"],
    ["作物が空", { itemIds: [] }, "itemIds"],
    ["運営が止めている受渡枠", { seriesIds: ["series-off"] }, "seriesIds"],
    ["存在しない受渡枠", { seriesIds: ["series-a", "series-x"] }, "seriesIds"],
    ["受渡枠が空", { seriesIds: [] }, "seriesIds"],
    ["連絡先がどちらもない", { contactPhone: "", contactEmail: " " }, "contactPhone"],
    ["メールの形式", { contactPhone: "", contactEmail: "farm@" }, "contactEmail"],
    ["生産スタイルが選択肢にない", { productionStyle: "huge" }, "productionStyle"],
    ["販売先に選択肢にない値", { salesChannels: ["market", "auction"] }, "salesChannels"],
    ["対応できることに選択肢にない値", { capabilities: ["delivery"] }, "capabilities"],
    ["生産者名が空", { producerName: "" }, "producerName"],
    ["その他の作物が長すぎる", { otherCrops: "あ".repeat(101) }, "otherCrops"],
  ])("%s → 400（errors.%s）・何も保存しない", async (_label, over, field) => {
    const res = await post(producerApi, producerBody(over), P);
    expect(res.status).toBe(400);
    expect((await res.json()).errors[field as string]).toBeTruthy();
    expect(mem.state.producers).toHaveLength(0);
    expect(mem.state.producerItems).toHaveLength(0);
    expect(mem.state.seriesParticipants).toHaveLength(0);
    expect(userOf("u-p").onboardedAt).toBeNull();
  });
  it("販売先・対応できることは選ばなくても登録でき、空の配列で保存する", async () => {
    const res = await post(producerApi, producerBody({ salesChannels: [], capabilities: undefined }), P);
    expect(res.status).toBe(200);
    expect(mem.state.producers[0]).toMatchObject({ salesChannels: [], capabilities: [] });
  });
  it("運営が止めた定期枠（active=false）：新しく参加はできないが、すでに参加している生産者・作った回は残る", async () => {
    expect((await post(producerApi, producerBody({ seriesIds: ["series-a"] }), P)).status).toBe(200);
    const before = { series: [...mem.state.seriesParticipants], slots: [...mem.state.slotParticipants] };
    mem.state.slotSeries.find((s) => s.id === "series-a")!.active = false;
    mem.state.users.push({ id: "u-p2", role: "producer", displayName: "（未設定）", onboardedAt: null });
    const late = await post(producerApi, producerBody({ seriesIds: ["series-a"] }), cookieFor("u-p2", "producer"));
    expect(late.status).toBe(400);
    expect((await late.json()).errors.seriesIds).toBeTruthy();
    expect(mem.state.seriesParticipants).toEqual(before.series);
    expect(mem.state.slotParticipants).toEqual(before.slots);
    expect(mem.state.handoverSlots).toHaveLength(3);
    const master = await (await get(masterApi, P)).json();
    expect(master.series).toEqual([]);
  });
  it("ログイン用のメールアドレスを連絡先に自動で入れない（送られた連絡先だけ）", async () => {
    await post(producerApi, producerBody({ contactPhone: "", contactEmail: "contact@example.com" }), P);
    expect(mem.state.producers[0]).toMatchObject({ contactPhone: null, contactEmail: "contact@example.com" });
  });
});

describe("transaction：途中で失敗したら何も残さない", () => {
  it.each(["producer.create", "producerItem.createMany", "slotSeriesParticipant.createMany", "user.updateMany"])("生産者：%s で失敗 → 500・登録済みにならない", async (op) => {
    mem.failOn = op;
    const res = await post(producerApi, producerBody(), P);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("injected");
    expect(userOf("u-p").onboardedAt).toBeNull();
    expect(mem.state.producers).toHaveLength(0);
    expect(mem.state.producerItems).toHaveLength(0);
    expect(mem.state.seriesParticipants).toHaveLength(0);
    expect(mem.state.slotParticipants).toHaveLength(0);
    // 失敗のあとで送り直せば完了できる
    mem.failOn = null;
    expect((await post(producerApi, producerBody(), P)).status).toBe(200);
    expect(mem.state.producers).toHaveLength(1);
  });
  it.each(["restaurant.create", "user.updateMany"])("飲食店：%s で失敗 → 500・登録済みにならない", async (op) => {
    mem.failOn = op;
    expect((await post(restaurantApi, restaurantBody(), R)).status).toBe(500);
    expect(userOf("u-r").onboardedAt).toBeNull();
    expect(mem.state.restaurants).toHaveLength(0);
  });
});

describe("再送・二重送信", () => {
  it("完了後に同じ内容を送り直しても成功（完了済み）・2件目は作らない", async () => {
    expect((await post(restaurantApi, restaurantBody(), R)).status).toBe(200);
    const again = await post(restaurantApi, restaurantBody({ name: "別の名前" }), R);
    expect(again.status).toBe(200);
    expect((await again.json()).status).toBe("already-completed");
    expect(mem.state.restaurants).toHaveLength(1);
    expect(mem.state.restaurants[0].name).toBe("テスト食堂");
  });
  it("同時に2回送っても、作られるのは1件で、どちらも成功", async () => {
    const [a, b] = await Promise.all([post(producerApi, producerBody(), P), post(producerApi, producerBody(), P)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([(await a.json()).status, (await b.json()).status].sort()).toEqual(["already-completed", "completed"]);
    expect(mem.state.producers).toHaveLength(1);
    expect(mem.state.producerItems).toHaveLength(2);
  });
  it("登録済みなのにプロフィールがない（不整合）→ 409", async () => {
    userOf("u-r").onboardedAt = new Date();
    expect((await post(restaurantApi, restaurantBody(), R)).status).toBe(409);
    expect(mem.state.restaurants).toHaveLength(0);
  });
  it("登録前なのにプロフィールだけある（不整合）→ 409", async () => {
    mem.state.producers.push({ id: "p-old", ownerUserId: "u-p", farmName: "古い農園", originPrefecture: "大阪府" });
    expect((await post(producerApi, producerBody(), P)).status).toBe(409);
    expect(userOf("u-p").onboardedAt).toBeNull();
  });
});

describe("権限", () => {
  it("未ログインは 401（完了 API・マスタ API）", async () => {
    expect((await post(restaurantApi, restaurantBody())).status).toBe(401);
    expect((await post(producerApi, producerBody())).status).toBe(401);
    expect((await get(masterApi)).status).toBe(401);
  });
  it("ロールが違う送信先は 403", async () => {
    expect((await post(producerApi, producerBody(), R)).status).toBe(403);
    expect((await post(restaurantApi, restaurantBody(), P)).status).toBe(403);
    expect((await get(masterApi, R)).status).toBe(403);
    expect(mem.state.producers).toHaveLength(0);
    expect(mem.state.restaurants).toHaveLength(0);
  });
  it("別サイトからの送信は 403", async () => {
    const res = await restaurantApi.POST(new Request(`${BASE}/api`, { method: "POST", headers: { "content-type": "application/json", cookie: R, origin: "https://evil.example" }, body: JSON.stringify(restaurantBody()) }));
    expect(res.status).toBe(403);
  });
  it("demo mode では使えない（404）", async () => {
    vi.stubEnv("APP_MODE", "demo");
    expect((await post(restaurantApi, restaurantBody(), R)).status).toBe(404);
    expect((await get(masterApi, P)).status).toBe(404);
  });
  it("登録前は既存のロール別 API を使えず、登録後は使える", async () => {
    expect((await get(supplies, P)).status).toBe(403);
    expect((await get(approvals, R)).status).toBe(403);
    await post(producerApi, producerBody(), P);
    await post(restaurantApi, restaurantBody(), R);
    expect((await get(supplies, P)).status).toBe(200);
    expect((await get(approvals, R)).status).toBe(200);
    // 登録後も、ほかのロールの API は使えない
    expect((await get(supplies, R)).status).toBe(403);
  });
});

describe("登録画面用のマスタ API", () => {
  it("品目と、有効な受渡枠だけを返す（内部の設定値は返さない）", async () => {
    const res = await get(masterApi, P);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.items).toEqual([{ id: "item-tomato", name: "トマト" }, { id: "item-eggplant", name: "なす" }]);
    expect(d.series).toEqual([{ id: "series-a", placeName: "梅田エリア受渡所（仮）", placeAddress: "大阪市北区", weekday: 2, startTime: "10:00", endTime: "11:00", feeYen: 800 }]);
  });
  it("登録済みの生産者も使える", async () => {
    await post(producerApi, producerBody(), P);
    expect((await get(masterApi, P)).status).toBe(200);
  });
});
