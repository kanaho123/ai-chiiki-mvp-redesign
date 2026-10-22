import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRequest, PlanSlot, PlanSupply } from "../src/lib/allocate";

// Exercise the real authorization, recomputation and response handlers against a memory DB.
const db = vi.hoisted(() => ({ rows: [] as any[], messages: [] as any[], reviews: [] as any[], usuals: [] as any[], inputs: {} as any, version: "v1", now: new Date("2026-10-22T03:00:00Z"), users: new Map<string, any>(), contacts: new Map<string, any>() }));
vi.mock("./db.js", () => {
  const producer = {
    findUnique: async ({ where }: any) => db.contacts.get(where.id) ?? null,
    findFirst: async ({ where }: any) => {
      const c = db.contacts.get(where.id);
      return c?.ownerUserId === where.ownerUserId ? { contactPhone: c.contactPhone, contactEmail: c.contactEmail } : null;
    },
    updateMany: async ({ where, data }: any) => {
      const c = db.contacts.get(where.id);
      if (!c || c.ownerUserId !== where.ownerUserId) return { count: 0 };
      Object.assign(c, data); return { count: 1 };
    },
  };
  const match = (r: any, where: any) => Object.entries(where).every(([key, value]) => r[key] === value);
  // 取引のやり取り（作成と、相談ごとの一覧だけ）
  const tradeMessage = {
    findMany: async ({ where, take }: any) => db.messages.filter(m => m.approvalRequestId === where.approvalRequestId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, take),
    create: async ({ data }: any) => { const m = { ...data, id: `m-${String(db.messages.length + 1).padStart(3, "0")}`, createdAt: new Date(Date.now()) }; db.messages.push(m); return m; },
  };
  // 取引後の評価・いつもの農家（一意の組で探す・作るだけ）
  const tradeReview = {
    findUnique: async ({ where }: any) => db.reviews.find(r => r.approvalRequestId === where.approvalRequestId_reviewerRole.approvalRequestId && r.reviewerRole === where.approvalRequestId_reviewerRole.reviewerRole) ?? null,
    create: async ({ data }: any) => {
      if (db.reviews.some(r => r.approvalRequestId === data.approvalRequestId && r.reviewerRole === data.reviewerRole)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const r = { ...data, id: `rv-${db.reviews.length + 1}`, createdAt: new Date("2026-10-22T06:00:00Z") }; db.reviews.push(r); return r;
    },
  };
  const usualProducer = {
    findUnique: async ({ where }: any) => db.usuals.find(u => u.restaurantUserId === where.restaurantUserId_producerId.restaurantUserId && u.producerId === where.restaurantUserId_producerId.producerId) ?? null,
    createMany: async ({ data }: any) => {
      let count = 0;
      for (const d of data) if (!db.usuals.some(u => u.restaurantUserId === d.restaurantUserId && u.producerId === d.producerId)) { db.usuals.push({ ...d, createdAt: new Date() }); count++; }
      return { count };
    },
  };
  const tx: any = {
    producer, tradeMessage, tradeReview, usualProducer,
    item: { findUnique: async () => ({ name: "トマト" }) },
    approvalRequest: {
      createMany: async ({ data }: any) => {
        for (const row of data) if (!db.rows.some(r => r.restaurantId === row.restaurantId && r.supplyId === row.supplyId && r.planFingerprint === row.planFingerprint)) db.rows.push({ ...row, id: `req-${db.rows.length + 1}`, status: "pending", createdAt: new Date(), respondedAt: null, receivedAt: null });
      },
      findUnique: async ({ where }: any) => db.rows.find(r => r.id === where.id) ?? null,
      findMany: async ({ where }: any) => db.rows.filter(r => match(r, where)).map(r => ({ ...r, restaurant: { displayName: r.restaurantId }, producer: { farmName: r.producerId } })),
      updateMany: async ({ where, data }: any) => {
        const rows = db.rows.filter(r => match(r, where)); rows.forEach(r => Object.assign(r, data)); return { count: rows.length };
      },
    },
  };
  // findUnique includes only the two public names, as the real query does.
  const findUnique = tx.approvalRequest.findUnique;
  tx.approvalRequest.findUnique = async (args: any) => {
    const row = await findUnique(args);
    return row && { ...row, restaurant: { displayName: row.restaurantId }, producer: { farmName: row.producerId } };
  };
  return { prisma: { ...tx, $transaction: async (fn: any) => fn(tx) } };
});
vi.mock("./repo.js", () => ({ repo: { findSessionUser: async (id: string) => db.users.get(id) ?? null } }));
vi.mock("./plan-data.js", () => ({ loadPlanInputs: async () => ({ inputs: db.inputs, version: db.version }) }));
vi.mock("./clock.js", () => ({ serverNow: () => db.now }));

const { createSessionToken } = await import("./auth");
const { allocatePlan } = await import("../src/lib/allocate");
const { planFingerprint } = await import("./plan-fingerprint");
const { approvals, parseContact } = await import("./approvals");
const api = await import("./routes/approvals/index");
const one = await import("./routes/approvals/[id]");
const { overallConfirmation } = await import("../src/lib/approvals");
const msgs = await import("./routes/approvals/messages");
const received = await import("./routes/approvals/received");
const reviewRoute = await import("./routes/approvals/review");
const usualRoute = await import("./routes/approvals/usual");
const { trades } = await import("./approvals");
const { prisma: mockPrisma } = await import("./db.js");
const { TRADE_DECLINED, consultationStatus } = await import("../src/lib/approvals");

const request: PlanRequest = {
  itemId: "tomato", varietyId: null, quantityKg: 10, desiredDate: "2026-10-23", budgetYen: null,
  originPrefectures: ["大阪府"], slotId: "gp", allowIrregular: false, allowMixedVarieties: false,
  allowMixedGrades: false, allowFirstTime: true, preferredProducerId: null,
};
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghijklmnop";
  db.rows = []; db.messages = []; db.reviews = []; db.usuals = []; db.version = "v1"; db.now = new Date("2026-10-22T03:00:00Z"); db.users.clear(); db.contacts.clear();
  for (const id of ["r1", "r2", "a", "b"]) {
    const producer = ["a", "b"].includes(id);
    db.users.set(id, { id, role: producer ? "producer" : "restaurant", displayName: id, producer: producer ? { id: `p-${id}`, farmName: id, originPrefecture: "大阪府" } : null, onboarded: true });
    if (producer) db.contacts.set(`p-${id}`, { ownerUserId: id, contactPhone: null, contactEmail: `${id}@example.invalid` });
  }
  const slot: PlanSlot = { id: "gp", label: "G-P", placeName: "P", startAt: "2026-10-23T01:00:00Z", endAt: "2026-10-23T02:00:00Z", confirmDeadlineAt: "2026-10-22T08:00:00Z", feeYen: 800, feeConfirmed: true, maxKg: 20, conditionsConfirmed: true };
  const supplies: PlanSupply[] = ["a", "b"].map(key => ({ id: `s-${key}`, producerId: `p-${key}`, producerName: key, itemId: "tomato", varietyId: "t", varietyName: "T", grade: "regular", irregularReason: null, originPrefecture: "大阪府", availableKg: 5, priceYenPerKg: 600, minKg: 1, slotId: "gp", published: true, version: 1, updatedAt: "2026-10-22T00:00:00Z" }));
  db.inputs = { supplies, slot, participants: supplies.map(s => ({ slotId: "gp", producerId: s.producerId, confirmed: true })), relationships: [] };
});
function body(req = request) {
  const plan = allocatePlan({ ...db.inputs, request: req, now: db.now });
  return { request: req, version: db.version, fingerprint: planFingerprint(req, db.version, plan) };
}
function req(id: string | null, method = "GET", payload?: unknown, path = "/api/approvals") {
  const user = id && db.users.get(id);
  return new Request(`http://localhost:5173${path}`, { method, headers: { "Content-Type": "application/json", ...(user && { cookie: `aic_session=${createSessionToken(user, new Date())}` }) }, ...(payload !== undefined && { body: JSON.stringify(payload) }) });
}
const create = () => approvals.create(db.users.get("r1"), body());

describe("相談カードの仕入れ条件（保存済みの planRequest から）", () => {
  it("生産者・飲食店の一覧に、見せてよい条件だけを付ける（予算・優先したい農家は出さない）", async () => {
    await approvals.create(db.users.get("r1"), body({ ...request, budgetYen: 9000 }));
    for (const who of ["a", "r1"]) {
      const rows = await approvals.list(db.users.get(who));
      expect(rows[0].conditions).toEqual({ requestedKg: 10, desiredDate: "2026-10-23", originPrefectures: ["大阪府"], allowIrregular: false, allowFirstTime: true, allowMixedVarieties: false, allowMixedGrades: false });
      expect(JSON.stringify(rows)).not.toMatch(/budget|9000|preferredProducer/);
    }
  });
  it("価格などで供給の version が上がると、相談は「条件が変わりました」（既存の判定）", async () => {
    await create();
    db.version = "v2"; db.inputs.supplies[1].priceYenPerKg = 650; db.inputs.supplies[1].version++;
    expect((await approvals.list(db.users.get("r1"))).every(r => r.status === "stale")).toBe(true);
  });
});

describe("承認・連絡先の権限と整合性", () => {
  it("未ログイン・ロール違い・外部サイトからの変更を拒否する", async () => {
    expect((await api.POST(req(null, "POST", body()))).status).toBe(401);
    expect((await api.POST(req("a", "POST", body()))).status).toBe(403);
    expect((await one.PATCH(req("r1", "PATCH", { status: "approved" }, "/api/approvals/req-1"))).status).toBe(403);
    const external = req("r1", "POST", body()); external.headers.set("origin", "https://elsewhere.invalid");
    expect((await api.POST(external)).status).toBe(403);
    expect(db.rows).toHaveLength(0);
  });
  it("再送は同じ依頼を返し、クライアントの数量・価格の偽装を採用せず、在庫を減らさない", async () => {
    const before = JSON.stringify(db.inputs.supplies);
    const first = await create();
    db.now = new Date(db.now.getTime() + 1000); // Recalculation time alone must not change the confirmation target.
    const second = await approvals.create(db.users.get("r1"), { ...body(), allocations: [{ kg: 99, priceYenPerKg: 1 }] });
    expect(first.map(r => r.id)).toEqual(second.map(r => r.id)); expect(db.rows).toHaveLength(2);
    expect(first.map(r => r.quantityKg)).toEqual([5, 5]); expect(first[0].priceYenPerKg).toBe(600);
    expect(JSON.stringify(db.inputs.supplies)).toBe(before);
    expect(JSON.stringify(first)).not.toContain("example.invalid");
  });
  it("別の店・別の生産者の ID 指定を拒否し、各一覧を本人のものに限定する", async () => {
    const rows = await create(); const a = rows.find(r => r.producerName === "p-a")!;
    expect((await one.PATCH(req("b", "PATCH", { status: "approved" }, `/api/approvals/${a.id}`))).status).toBe(404);
    expect((await one.GET(req("r2", "GET", undefined, `/api/approvals/${a.id}`))).status).toBe(404);
    expect(await approvals.list(db.users.get("r2"))).toEqual([]);
    expect((await approvals.list(db.users.get("a"))).map(r => r.producerName)).toEqual(["p-a"]);
  });
  it("承認前・NGは連絡先を返さず、承認した農園だけ開示する", async () => {
    const rows = await create(); const a = rows.find(r => r.producerName === "p-a")!; const b = rows.find(r => r.producerName === "p-b")!;
    expect((await one.GET(req("r1", "GET", undefined, `/api/approvals/${a.id}`))).status).toBe(403);
    expect((await one.PATCH(req("a", "PATCH", { status: "approved" }, `/api/approvals/${a.id}`))).status).toBe(200);
    // 一部の農家だけの返事は「成立」とまとめず、返事待ちに回答済みの数だけを添える
    expect(overallConfirmation(await approvals.list(db.users.get("r1")))).toBe("返事待ち（1/2農家が回答済み）");
    const contact = await one.GET(req("r1", "GET", undefined, `/api/approvals/${a.id}`));
    expect((await contact.json()).contact.contactEmail).toBe("a@example.invalid");
    await approvals.respond(db.users.get("b"), b.id, "rejected");
    expect((await one.GET(req("r1", "GET", undefined, `/api/approvals/${b.id}`))).status).toBe(403);
    expect(overallConfirmation(await approvals.list(db.users.get("r1")))).toBe("一部対応できません");
    expect(JSON.stringify(await approvals.list(db.users.get("r1")))).not.toContain("example.invalid");
  });
  it("全員承認済と再回答の扱い。承認は在庫を変更しない", async () => {
    const rows = await create(); const original = JSON.stringify(db.inputs);
    for (const row of rows) { const key = row.producerName.replace("p-", ""); await approvals.respond(db.users.get(key), row.id, "approved"); }
    // 全農家が「対応できます」で、条件が変わっていないときだけマッチ成立
    expect(overallConfirmation(await approvals.list(db.users.get("r1")))).toBe("マッチ成立");
    await expect(approvals.respond(db.users.get("a"), rows[0].id, "approved")).resolves.toMatchObject({ status: "approved" });
    await expect(approvals.respond(db.users.get("a"), rows[0].id, "rejected")).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(db.inputs)).toBe(original);
  });
  it("在庫更新後は承認表示・回答・連絡先取得・古い案の送信を拒否する", async () => {
    const oldBody = body(); const rows = await create(); await approvals.respond(db.users.get("a"), rows[0].id, "approved");
    db.version = "v2"; db.inputs.supplies[0].version++;
    expect((await approvals.list(db.users.get("r1"))).every(r => r.status === "stale")).toBe(true);
    await expect(approvals.contact(db.users.get("r1"), rows[0].id)).rejects.toMatchObject({ status: 409 });
    await expect(approvals.respond(db.users.get("b"), rows[1].id, "approved")).rejects.toMatchObject({ status: 409 });
    await expect(approvals.create(db.users.get("r1"), oldBody)).rejects.toMatchObject({ status: 409 });
    const next = await create(); expect(next.every(r => r.status === "pending")).toBe(true); expect(db.rows).toHaveLength(4);
  });
  it("数量が違う案では古い承認を使い回さず、以前の依頼も消さない", async () => {
    const original = await create(); await approvals.respond(db.users.get("a"), original[0].id, "approved");
    const next = await approvals.create(db.users.get("r1"), body({ ...request, quantityKg: 9 }));
    expect(next.every(r => r.status === "pending")).toBe(true);
    expect(next[0].planFingerprint).not.toBe(original[0].planFingerprint); expect(db.rows).toHaveLength(4);
    expect(db.rows.find(r => r.id === original[0].id).status).toBe("approved");
  });
  it("締切を過ぎた案は承認済でも開示しない", async () => {
    const rows = await create(); await approvals.respond(db.users.get("a"), rows[0].id, "approved");
    db.now = new Date("2026-10-22T08:00:00Z");
    await expect(approvals.contact(db.users.get("r1"), rows[0].id)).rejects.toMatchObject({ status: 409 });
    expect((await approvals.list(db.users.get("r1")))[0].status).toBe("stale");
  });
  it("連絡先が無い生産者は承認前に登録が必要。プロフィールの更新先も本人固定", async () => {
    const rows = await create(); db.contacts.get("p-a").contactEmail = null;
    await expect(approvals.respond(db.users.get("a"), rows[0].id, "approved")).rejects.toMatchObject({ status: 400 });
    expect((await api.GET(req("r1", "GET", undefined, "/api/approvals?view=contact"))).status).toBe(403);
    const response = await api.PATCH(req("a", "PATCH", { producerId: "p-b", contactPhone: "", contactEmail: "new@example.invalid" }));
    expect(response.status).toBe(200); expect(db.contacts.get("p-a").contactEmail).toBe("new@example.invalid"); expect(db.contacts.get("p-b").contactEmail).toBe("b@example.invalid");
    // 電話だけ・メールだけで保存でき、両方空は拒否（変更しない）。飲食店は変更できない
    expect((await api.PATCH(req("a", "PATCH", { contactPhone: "000-1111-2222", contactEmail: "" }))).status).toBe(200);
    expect(db.contacts.get("p-a")).toMatchObject({ contactPhone: "000-1111-2222", contactEmail: null });
    expect((await api.PATCH(req("a", "PATCH", { contactPhone: "", contactEmail: "only@example.invalid" }))).status).toBe(200);
    expect(db.contacts.get("p-a")).toMatchObject({ contactPhone: null, contactEmail: "only@example.invalid" });
    expect((await api.PATCH(req("a", "PATCH", { contactPhone: " ", contactEmail: "" }))).status).toBe(400);
    expect(db.contacts.get("p-a")).toMatchObject({ contactPhone: null, contactEmail: "only@example.invalid" });
    expect((await api.PATCH(req("r1", "PATCH", { contactPhone: "000-9999-9999", contactEmail: "" }))).status).toBe(403);
    expect(db.contacts.get("p-b").contactEmail).toBe("b@example.invalid");
    expect(() => parseContact({ contactPhone: "javascript:alert(1)", contactEmail: "" })).toThrow();
    expect(() => parseContact({ contactPhone: "", contactEmail: "a@example.invalid\r\nBcc:x@y.com" })).toThrow();
  });
});

describe("取引：成立までは今までどおり計算し直し、全農家が「対応できます」になったら固定する", () => {
  const approveAll = async (rows: any[]) => { for (const row of rows) await approvals.respond(db.users.get(row.producerName.replace("p-", "")), row.id, "approved"); };
  const change = () => { db.version = "v2"; db.inputs.supplies[0].priceYenPerKg = 999; db.inputs.supplies[0].availableKg = 1; db.inputs.supplies[0].version++; };

  it("1. 返事待ちの間に出品が変わる → 今までどおり「条件が変わりました」", async () => {
    await create(); change();
    expect((await approvals.list(db.users.get("r1"))).every(r => r.status === "stale" && !r.established)).toBe(true);
  });
  it("2. 1農家だけ「対応できます」、ほかが返事待ちのときに出品が変わる → stale（まだ成立前）", async () => {
    const rows = await create(); await approvals.respond(db.users.get("a"), rows[0].id, "approved"); change();
    expect((await approvals.list(db.users.get("r1"))).every(r => r.status === "stale")).toBe(true);
  });
  it("3・4. 全農家が「対応できます」→ 取引成立。そのあと価格・数量・在庫の版・締切が変わっても、保存した内容で固定（連絡先も見られる）", async () => {
    const rows = await create(); await approveAll(rows);
    const before = await approvals.list(db.users.get("r1"));
    expect(before.every(r => r.status === "approved" && r.established)).toBe(true);
    expect(overallConfirmation(before)).toBe("マッチ成立");
    change(); db.now = new Date("2026-10-22T09:00:00Z"); // 締切（08:00Z）も過ぎた
    const after = await approvals.list(db.users.get("r1"));
    expect(after.map(r => [r.status, r.quantityKg, r.priceYenPerKg, r.subtotalYen, r.pickupPlace])).toEqual(before.map(r => [r.status, r.quantityKg, r.priceYenPerKg, r.subtotalYen, r.pickupPlace]));
    expect(overallConfirmation(after)).toBe("マッチ成立");
    expect((await approvals.list(db.users.get("a")))[0]).toMatchObject({ status: "approved", established: true });
    await expect(approvals.contact(db.users.get("r1"), rows[0].id)).resolves.toMatchObject({ contactEmail: "a@example.invalid" });
    expect(db.rows.map(r => r.priceYenPerKg)).toEqual([600, 600]); // 保存した値は変えない
  });
});

describe("取引のやり取り（テキストだけ）", () => {
  let clock = Date.UTC(2026, 9, 22, 3, 0, 0);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
  afterEach(() => { vi.useRealTimers(); });
  const tick = () => vi.setSystemTime(new Date((clock += 2000))); // 1秒の連打防止に掛からないように
  const send = async (who: string, id: string, text: string) => { tick(); return msgs.POST(req(who, "POST", { body: text }, `/api/approvals/${id}/messages`)); };
  const read = async (who: string | null, id: string) => msgs.GET(req(who, "GET", undefined, `/api/approvals/${id}/messages`));
  const established = async () => { const rows = await create(); for (const r of rows) await approvals.respond(db.users.get(r.producerName.replace("p-", "")), r.id, "approved"); return rows; };

  it("5. 全農家が「対応できます」になるまでは、やり取りできない（409）", async () => {
    const rows = await create();
    expect((await read("r1", rows[0].id)).status).toBe(409);
    await approvals.respond(db.users.get("a"), rows[0].id, "approved");
    expect((await send("r1", rows[0].id, "よろしくお願いします")).status).toBe(409);
    expect((await read("a", rows[0].id)).status).toBe(409);
    expect(db.messages).toHaveLength(0);
  });
  it("6・7. 成立後は飲食店⇄その農家だけ。ほかの店・ほかの農家は読めず書けない。ほかの農家とのやり取りは混ざらない", async () => {
    const [a, b] = await established();
    expect((await send("r1", a.id, "  当日はよろしくお願いします  ")).status).toBe(201);
    expect((await send("a", a.id, "こちらこそ、よろしくお願いします")).status).toBe(201);
    expect((await send("r1", b.id, "B農園さん宛て")).status).toBe(201);
    const ra = await (await read("r1", a.id)).json();
    expect(ra.messages.map((m: any) => [m.body, m.sender, m.senderName, m.mine])).toEqual([
      ["当日はよろしくお願いします", "restaurant", "r1", true], ["こちらこそ、よろしくお願いします", "producer", "p-a", false],
    ]);
    const aa = await (await read("a", a.id)).json();
    expect(aa.messages.map((m: any) => m.mine)).toEqual([false, true]);
    expect(JSON.stringify(aa)).not.toContain("B農園さん宛て");
    expect((await read("b", a.id)).status).toBe(404);
    expect((await send("b", a.id, "割り込み")).status).toBe(404);
    expect((await read("r2", a.id)).status).toBe(404);
    expect((await read(null, a.id)).status).toBe(401);
    const bb = await (await read("b", b.id)).json();
    expect(bb.messages.map((m: any) => m.body)).toEqual(["B農園さん宛て"]);
  });
  it("本文：前後の空白を除いて1〜1000文字。空・長すぎは送れない。外部サイトからは送れない。連打は1秒に1通まで", async () => {
    const [a] = await established();
    expect((await send("r1", a.id, "   ")).status).toBe(400);
    expect((await send("r1", a.id, "あ".repeat(1001))).status).toBe(400);
    expect((await send("r1", a.id, "あ".repeat(1000))).status).toBe(201);
    const external = req("r1", "POST", { body: "x" }, `/api/approvals/${a.id}/messages`); external.headers.set("origin", "https://elsewhere.invalid");
    tick(); expect((await msgs.POST(external)).status).toBe(403);
    tick(); expect((await msgs.POST(req("r1", "POST", { body: "1通目" }, `/api/approvals/${a.id}/messages`))).status).toBe(201);
    expect((await msgs.POST(req("r1", "POST", { body: "すぐ2通目" }, `/api/approvals/${a.id}/messages`))).status).toBe(429);
    expect(db.messages).toHaveLength(2);
  });
});

describe("受け取り完了（仕入れ案ごとに1回）", () => {
  const done = (who: string, fingerprint: unknown) => received.POST(req(who, "POST", { fingerprint }, "/api/approvals/received"));

  it("8. 1農家でも「対応できません」なら完了できない（その旨の文）。返事待ちでも完了できない", async () => {
    const rows = await create();
    expect((await done("r1", rows[0].planFingerprint)).status).toBe(409);
    await approvals.respond(db.users.get("a"), rows[0].id, "approved");
    await approvals.respond(db.users.get("b"), rows[1].id, "rejected");
    const r = await done("r1", rows[0].planFingerprint);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe(TRADE_DECLINED);
    expect(db.rows.every(x => x.receivedAt === null)).toBe(true);
  });
  it("9・10・11. 1回で同じ仕入れ案の全農家に同じ receivedAt。もう一度押しても変わらない。完了後は「取引完了」、やり取りは読むだけ", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-22T04:00:00Z"));
    const rows = await create();
    for (const r of rows) await approvals.respond(db.users.get(r.producerName.replace("p-", "")), r.id, "approved");
    expect((await done("a", rows[0].planFingerprint)).status).toBe(403); // 生産者は押せない
    expect((await done("r2", rows[0].planFingerprint)).status).toBe(404); // ほかの店の相談は見つからない
    expect((await done("r1", "not-a-fingerprint")).status).toBe(400);
    const first = await done("r1", rows[0].planFingerprint);
    expect(first.status).toBe(200);
    const at = db.rows[0].receivedAt;
    expect(at).toBeInstanceOf(Date);
    expect(db.rows.every(x => x.receivedAt.getTime() === at.getTime())).toBe(true);
    vi.setSystemTime(new Date("2026-10-22T05:00:00Z"));
    const second = await done("r1", rows[0].planFingerprint);
    expect(second.status).toBe(200);
    expect(db.rows.every(x => x.receivedAt.getTime() === at.getTime())).toBe(true);
    const list = await approvals.list(db.users.get("r1"));
    expect(consultationStatus(list)).toBe("completed");
    expect(list.every(r => r.receivedAt === at.toISOString())).toBe(true);
    expect((await approvals.list(db.users.get("a")))[0].receivedAt).toBe(at.toISOString());
    vi.setSystemTime(new Date("2026-10-22T05:00:10Z"));
    const after = await msgs.POST(req("r1", "POST", { body: "完了後" }, `/api/approvals/${rows[0].id}/messages`));
    expect(after.status).toBe(409);
    expect((await (await msgs.GET(req("a", "GET", undefined, `/api/approvals/${rows[0].id}/messages`))).json()).completed).toBe(true);
    vi.useRealTimers();
  });
});

describe("取引後の評価と「いつもの農家」（受け取り完了後だけ。保存と本人への表示だけ）", () => {
  const path = (id: string, what: "review" | "usual") => `/api/approvals/${id}/${what}`;
  const getReview = (who: string | null, id: string) => reviewRoute.GET(req(who, "GET", undefined, path(id, "review")));
  const postReview = (who: string | null, id: string, payload: unknown) => reviewRoute.POST(req(who, "POST", payload, path(id, "review")));
  const postUsual = (who: string | null, id: string) => usualRoute.POST(req(who, "POST", {}, path(id, "usual")));
  /** 2農家の仕入れ案を、全農家「対応できます」→ 受け取り完了まで進める */
  const completed = async () => {
    const rows = await create();
    for (const r of rows) await approvals.respond(db.users.get(r.producerName.replace("p-", "")), r.id, "approved");
    await trades.received(db.users.get("r1"), rows[0].planFingerprint);
    return rows;
  };

  it("受け取り完了前（返事待ち・マッチ成立）は評価も登録もできない（409）", async () => {
    const rows = await create();
    expect((await getReview("r1", rows[0].id)).status).toBe(409);
    expect((await postReview("r1", rows[0].id, { rating: "good" })).status).toBe(409);
    for (const r of rows) await approvals.respond(db.users.get(r.producerName.replace("p-", "")), r.id, "approved");
    const res = await postUsual("r1", rows[0].id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("受け取りが完了した取引だけ、評価や「いつもの農家」の登録ができます");
    expect((await postReview("a", rows[0].id, { rating: "good" })).status).toBe(409);
    expect(db.reviews).toHaveLength(0);
    expect(db.usuals).toHaveLength(0);
  });

  it("飲食店・生産者がそれぞれ1回ずつ、農家ごとに評価できる。読めるのは自分の評価だけ", async () => {
    const [a, b] = await completed();
    expect(await (await getReview("r1", a.id)).json()).toEqual({ review: null, usual: false });
    expect(await (await getReview("a", a.id)).json()).toEqual({ review: null, usual: null });
    const r = await postReview("r1", a.id, { rating: "good", comment: "  丁寧でした  " });
    expect(r.status).toBe(201);
    expect((await r.json()).review).toEqual({ rating: "good", comment: "丁寧でした", createdAt: "2026-10-22T06:00:00.000Z" });
    // 同じ相談・同じ側からは1回だけ（変更もしない）
    const again = await postReview("r1", a.id, { rating: "bad" });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("この取引はすでに評価しています");
    // 生産者側は別に1回。飲食店の評価は見えない
    expect((await getReview("a", a.id)).status).toBe(200);
    expect((await (await getReview("a", a.id)).json()).review).toBeNull();
    expect((await postReview("a", a.id, { rating: "bad", comment: "" })).status).toBe(201);
    expect((await (await getReview("a", a.id)).json()).review).toMatchObject({ rating: "bad", comment: null });
    expect((await (await getReview("r1", a.id)).json()).review).toMatchObject({ rating: "good", comment: "丁寧でした" });
    // もう1農家（B）は別の取引として評価できる
    expect((await (await getReview("r1", b.id)).json()).review).toBeNull();
    expect((await postReview("r1", b.id, { rating: "bad" })).status).toBe(201);
    expect(db.reviews.map((x) => [x.approvalRequestId, x.reviewerRole, x.reviewerUserId, x.rating, x.comment])).toEqual([
      [a.id, "restaurant", "r1", "good", "丁寧でした"], [a.id, "producer", "a", "bad", null], [b.id, "restaurant", "r1", "bad", null],
    ]);
  });

  it("権限：ほかの店・ほかの農家・未ログイン・外部サイトからは使えない。生産者は「いつもの農家」を登録できない", async () => {
    const [a] = await completed();
    expect((await getReview("r2", a.id)).status).toBe(404);
    expect((await getReview("b", a.id)).status).toBe(404);
    expect((await postReview("b", a.id, { rating: "good" })).status).toBe(404);
    expect((await getReview(null, a.id)).status).toBe(401);
    expect((await postUsual("a", a.id)).status).toBe(403);
    expect((await postUsual("r2", a.id)).status).toBe(404);
    const external = req("r1", "POST", { rating: "good" }, path(a.id, "review")); external.headers.set("origin", "https://elsewhere.invalid");
    expect((await reviewRoute.POST(external)).status).toBe(403);
    expect((await getReview("r1", "bad id!")).status).toBe(400);
    expect(db.reviews).toHaveLength(0);
    expect(db.usuals).toHaveLength(0);
  });

  it("入力：「良かった」「残念だった」のどちらか。一言は前後の空白を除いて100文字まで", async () => {
    const [a] = await completed();
    expect((await postReview("r1", a.id, {})).status).toBe(400);
    expect((await postReview("r1", a.id, { rating: "great" })).status).toBe(400);
    expect((await postReview("r1", a.id, { rating: "good", comment: 3 })).status).toBe(400);
    const long = await postReview("r1", a.id, { rating: "good", comment: "あ".repeat(101) });
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe("一言コメントは100文字以内で入力してください");
    expect((await postReview("r1", a.id, { rating: "good", comment: ` ${"あ".repeat(100)} ` })).status).toBe(201);
  });

  it("いつもの農家：受け取り完了した取引の農家だけ。2回押しても1件。マッチング（取引経験・計算の入力・相談の状態）は変えない", async () => {
    const [a, b] = await completed();
    const relationshipsBefore = JSON.stringify(db.inputs.relationships);
    const before = await approvals.list(db.users.get("r1"));
    const r = await postUsual("r1", a.id);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ usual: true });
    expect((await postUsual("r1", a.id)).status).toBe(200);
    expect(db.usuals.map((u) => [u.restaurantUserId, u.producerId, u.approvalRequestId])).toEqual([["r1", "p-a", a.id]]);
    expect((await (await getReview("r1", a.id)).json()).usual).toBe(true);
    expect((await (await getReview("r1", b.id)).json()).usual).toBe(false); // 農家ごと
    expect(JSON.stringify(db.inputs.relationships)).toBe(relationshipsBefore);
    expect(await approvals.list(db.users.get("r1"))).toEqual(before);
    expect(db.reviews).toHaveLength(0); // 評価とは別
  });
});

describe("セキュリティ：取引後の評価・いつもの農家の API（本人・権限・状態・入力・エラー）", () => {
  const path = (id: string, what: "review" | "usual") => `/api/approvals/${id}/${what}`;
  const postReview = (who: string | null, id: string, payload: unknown) => reviewRoute.POST(req(who, "POST", payload, path(id, "review")));
  const postUsual = (who: string | null, id: string, payload: unknown = {}) => usualRoute.POST(req(who, "POST", payload, path(id, "usual")));
  const getReview = (who: string | null, id: string) => reviewRoute.GET(req(who, "GET", undefined, path(id, "review")));
  const respondAll = async (rows: any[], status: "approved" | "rejected" = "approved") => { for (const r of rows) await approvals.respond(db.users.get(r.producerName.replace("p-", "")), r.id, status); };
  const completed = async () => { const rows = await create(); await respondAll(rows); await trades.received(db.users.get("r1"), rows[0].planFingerprint); return rows; };
  const nothingSaved = () => { expect(db.reviews).toHaveLength(0); expect(db.usuals).toHaveLength(0); };

  it("1. 未ログインは評価・登録・取得のどれも 401", async () => {
    const [a] = await completed();
    expect((await postReview(null, a.id, { rating: "good" })).status).toBe(401);
    expect((await postUsual(null, a.id)).status).toBe(401);
    expect((await getReview(null, a.id)).status).toBe(401);
    nothingSaved();
  });
  it("オンボーディング前のユーザーは使えない（403）", async () => {
    const [a] = await completed();
    db.users.set("r1", { ...db.users.get("r1"), onboarded: false });
    expect((await postReview("r1", a.id, { rating: "good" })).status).toBe(403);
    expect((await postUsual("r1", a.id)).status).toBe(403);
    nothingSaved();
  });
  it("2・3. 飲食店Bは、飲食店Aの取引を評価も登録もできず、存在も分からない（404・同じ文）", async () => {
    const [a] = await completed();
    const r = await postReview("r2", a.id, { rating: "bad" });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("相談が見つかりません");
    expect((await postUsual("r2", a.id)).status).toBe(404);
    expect((await getReview("r2", a.id)).status).toBe(404);
    expect((await postReview("r2", "req-999", { rating: "bad" })).status).toBe(404); // 存在しない ID と同じ応答
    nothingSaved();
  });
  it("4. 生産者は「いつもの農家」を登録できない（自分の取引でも 403）", async () => {
    const [a] = await completed();
    expect((await postUsual("a", a.id)).status).toBe(403);
    nothingSaved();
  });
  it("5. 生産者Bは、同じ仕入れ案の生産者Aの取引を評価・取得できない（404）", async () => {
    const [a] = await completed();
    expect((await postReview("b", a.id, { rating: "good" })).status).toBe(404);
    expect((await getReview("b", a.id)).status).toBe(404);
    nothingSaved();
  });
  it("6・7. 受け取り完了なし（返事待ち・一部対応・対応できません・マッチ成立）は、サーバーで拒否する", async () => {
    const rows = await create();
    const both = async (id: string) => [(await postReview("r1", id, { rating: "good" })).status, (await postUsual("r1", id)).status];
    expect(await both(rows[0].id)).toEqual([409, 409]); // 返事待ち
    await approvals.respond(db.users.get("a"), rows[0].id, "approved");
    await approvals.respond(db.users.get("b"), rows[1].id, "rejected");
    expect(await both(rows[0].id)).toEqual([409, 409]); // 一部の農家だけ対応（成立していない）
    expect(await both(rows[1].id)).toEqual([409, 409]); // 対応できません
    expect((await postReview("b", rows[1].id, { rating: "bad" })).status).toBe(409);
    nothingSaved();
    // 別の仕入れ案：全農家が対応＝マッチ成立。受け取り完了の前は拒否
    db.rows = []; const again = await create(); await respondAll(again);
    expect(await both(again[0].id)).toEqual([409, 409]);
    expect((await postReview("a", again[0].id, { rating: "good" })).status).toBe(409);
    nothingSaved();
  });
  it("7. DB の行が食い違っていても（返事待ち・対応できませんの行に receivedAt）、状態を確かめて拒否する", async () => {
    const rows = await create();
    rows.forEach((r: any) => { const row = db.rows.find((x) => x.id === r.id); row.receivedAt = new Date(); });
    expect((await postReview("r1", rows[0].id, { rating: "good" })).status).toBe(409);
    db.rows.find((x) => x.id === rows[0].id).status = "rejected";
    expect((await postUsual("r1", rows[0].id)).status).toBe(409);
    nothingSaved();
  });
  it("8. 2回目は 409。同時に送られて DB の一意制約（P2002）に当たっても 409 で、2件目は保存されない", async () => {
    const [a] = await completed();
    expect((await postReview("r1", a.id, { rating: "good" })).status).toBe(201);
    expect((await postReview("r1", a.id, { rating: "good" })).status).toBe(409);
    // 先に確かめる処理をすり抜けた同時送信：DB の一意制約で止まる
    const findUnique = (mockPrisma as any).tradeReview.findUnique;
    (mockPrisma as any).tradeReview.findUnique = async () => null;
    try {
      const raced = await postReview("r1", a.id, { rating: "bad" });
      expect(raced.status).toBe(409);
      expect((await raced.json()).error).toBe("この取引はすでに評価しています");
    } finally { (mockPrisma as any).tradeReview.findUnique = findUnique; }
    expect(db.reviews.map((r) => r.rating)).toEqual(["good"]);
  });
  it("12. 本文の ID・役割を書き換えても使わない（評価者・役割・相談・農家・店はサーバーが決める）", async () => {
    const [a, b] = await completed();
    expect((await postReview("r1", a.id, { rating: "good", comment: "ok", reviewerRole: "producer", reviewerUserId: "a", approvalRequestId: b.id, id: "forged" })).status).toBe(201);
    expect(db.reviews.map((r) => [r.approvalRequestId, r.reviewerRole, r.reviewerUserId, r.id])).toEqual([[a.id, "restaurant", "r1", "rv-1"]]);
    expect((await postUsual("r1", a.id, { producerId: "p-b", restaurantUserId: "r2", approvalRequestId: b.id })).status).toBe(200);
    expect(db.usuals.map((u) => [u.restaurantUserId, u.producerId, u.approvalRequestId])).toEqual([["r1", "p-a", a.id]]);
  });
  it("9. いつもの農家は何度押しても1件（API）。DB でも主キー（店・農家）で重複できない", async () => {
    const [a] = await completed();
    for (let i = 0; i < 3; i++) expect((await postUsual("r1", a.id)).status).toBe(200);
    expect(db.usuals).toHaveLength(1);
    const sql = readFileSync(new URL("../prisma/migrations/20261023090000_trade_review_usual_producer/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain('CONSTRAINT "usual_producers_pkey" PRIMARY KEY ("restaurantUserId","producerId")');
    expect(sql).toContain('CREATE UNIQUE INDEX "trade_reviews_approvalRequestId_reviewerRole_key" ON "trade_reviews"("approvalRequestId", "reviewerRole")');
  });
  it("10. コメントの上限はサーバーでも確かめる（101文字・文字列以外・大きすぎる本文は 400）", async () => {
    const [a] = await completed();
    expect((await postReview("r1", a.id, { rating: "good", comment: "😀".repeat(101) })).status).toBe(400);
    expect((await postReview("r1", a.id, { rating: "good", comment: ["x"] })).status).toBe(400);
    expect((await postReview("r1", a.id, { rating: "good", comment: { toString: "x" } })).status).toBe(400);
    expect((await postReview("r1", a.id, { rating: "good", comment: "x".repeat(20_000) })).status).toBe(400); // 10KB 超は読まない
    nothingSaved();
    expect((await postReview("r1", a.id, { rating: "good", comment: "😀".repeat(100) })).status).toBe(201); // 絵文字も1文字として数える
  });
  it("11. HTML のような文字列もそのまま文字として保存・返す（加工しない。表示側でエスケープする）", async () => {
    const [a] = await completed();
    const text = "<script>alert(1)</script>";
    const r = await postReview("r1", a.id, { rating: "good", comment: text });
    expect((await r.json()).review.comment).toBe(text);
    expect(r.headers.get("content-type")).toContain("application/json");
  });
  it("13. 想定外のエラーでは、接続情報・内部の文・スタックを返さない（500・決まった文）", async () => {
    const [a] = await completed();
    const create = (mockPrisma as any).tradeReview.create;
    (mockPrisma as any).tradeReview.create = async () => { const e = new Error("connect postgresql://neondb_owner:secret@ep-x.neon.tech/neondb at C:\\app\\server\\approvals.ts:300"); throw Object.assign(e, { code: "P1001" }); };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await postReview("r1", a.id, { rating: "good" });
      expect(r.status).toBe(500);
      const body = await r.text();
      expect(JSON.parse(body)).toEqual({ error: "サーバーで問題が発生しました。時間をおいてもう一度お試しください" });
      for (const leak of ["postgresql", "secret", "neon", "approvals.ts", "P1001", "stack"]) expect(body).not.toContain(leak);
      expect(spy.mock.calls.flat().join(" ")).not.toContain("secret"); // ログにもメッセージは出さない
    } finally { (mockPrisma as any).tradeReview.create = create; spy.mockRestore(); }
  });
  it("14. 別サイトからの POST（Origin が違う）は、評価・登録とも 403", async () => {
    const [a] = await completed();
    for (const [route, what, payload] of [[reviewRoute, "review", { rating: "good" }], [usualRoute, "usual", {}]] as const) {
      const r = req("r1", "POST", payload, path(a.id, what)); r.headers.set("origin", "https://evil.invalid");
      expect((await route.POST(r)).status).toBe(403);
    }
    nothingSaved();
  });
});
