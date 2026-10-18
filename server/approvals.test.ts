import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRequest, PlanSlot, PlanSupply } from "../src/lib/allocate";

// Exercise the real authorization, recomputation and response handlers against a memory DB.
const db = vi.hoisted(() => ({ rows: [] as any[], inputs: {} as any, version: "v1", now: new Date("2026-10-22T03:00:00Z"), users: new Map<string, any>(), contacts: new Map<string, any>() }));
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
  const tx: any = {
    producer,
    item: { findUnique: async () => ({ name: "トマト" }) },
    approvalRequest: {
      createMany: async ({ data }: any) => {
        for (const row of data) if (!db.rows.some(r => r.restaurantId === row.restaurantId && r.supplyId === row.supplyId && r.planFingerprint === row.planFingerprint)) db.rows.push({ ...row, id: `req-${db.rows.length + 1}`, status: "pending", createdAt: new Date(), respondedAt: null });
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

const request: PlanRequest = {
  itemId: "tomato", varietyId: null, quantityKg: 10, desiredDate: "2026-10-23", budgetYen: null,
  originPrefectures: ["大阪府"], slotId: "gp", allowIrregular: false, allowMixedVarieties: false,
  allowMixedGrades: false, allowFirstTime: true, preferredProducerId: null,
};
beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghijklmnop";
  db.rows = []; db.version = "v1"; db.now = new Date("2026-10-22T03:00:00Z"); db.users.clear(); db.contacts.clear();
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
    expect(overallConfirmation(await approvals.list(db.users.get("r1")))).toBe("返事待ち");
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
    expect(overallConfirmation(await approvals.list(db.users.get("r1")))).toBe("対応できます");
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
