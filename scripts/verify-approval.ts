// Isolated end-to-end fixtures; all writes are guarded and use approval-check-* IDs.
import { loadApprovalEnvironment } from "../server/local-env.js";
loadApprovalEnvironment();
const { prisma } = await import("../server/db.js");
const { hashPassword } = await import("../server/auth.js");
const { jstDateOf } = await import("../src/lib/dates.js");
const { serverNow } = await import("../server/clock.js");
const { overallConfirmation } = await import("../src/lib/approvals.js");
const base = process.env.APPROVAL_CHECK_URL ?? "http://127.0.0.1:5174";
const target = new URL(base);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.protocol !== "http:") throw new Error("Local development URL required");
const id = (key: string) => `approval-check-${key}`;
const userIds = ["r", "r2", "a", "b"].map(id);
const password = "local-approval-check-only-2026"; // Temporary fixture only, never an existing account password.
function check(ok: unknown, label: string): asserts ok { if (!ok) throw new Error(label); console.log(`PASS ${label}`); }
async function call(path: string, method = "GET", body?: unknown, cookie?: string) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie && { cookie }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const data = await r.json(); return { status: r.status, data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function cleanup() {
  await prisma.$transaction(async tx => {
    await tx.approvalRequest.deleteMany({ where: { restaurantId: { in: userIds } } });
    await tx.relationship.deleteMany({ where: { restaurantUserId: { in: userIds } } });
    await tx.supply.deleteMany({ where: { id: { in: [id("s-a"), id("s-b")] } } });
    await tx.slotParticipant.deleteMany({ where: { slotId: id("slot") } });
    await tx.producer.deleteMany({ where: { id: { in: [id("p-a"), id("p-b")] } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.handoverSlot.deleteMany({ where: { id: id("slot") } });
    await tx.place.deleteMany({ where: { id: id("place") } });
    await tx.variety.deleteMany({ where: { id: id("variety") } });
    await tx.item.deleteMany({ where: { id: id("item") } });
  }, { timeout: 30_000 });
}
try {
  if (process.argv.includes("--cleanup")) { await cleanup(); console.log("Isolated fixtures removed; original demo data untouched"); }
  else {
    if (await prisma.user.count({ where: { id: { in: userIds } } })) throw new Error("Fixture IDs already exist; explicitly clean them before retrying");
    const hash = await hashPassword(password);
    const nextDay = jstDateOf(new Date(serverNow().getTime() + 24 * 60 * 60 * 1000));
    const startAt = new Date(`${nextDay}T10:00:00+09:00`);
    await prisma.$transaction(async tx => {
      await tx.user.createMany({ data: userIds.map((uid, i) => ({ id: uid, role: i < 2 ? "restaurant" as const : "producer" as const, loginId: `demo-${uid}`, displayName: i < 2 ? `動作確認用の飲食店${i + 1}` : `動作確認用${i === 2 ? "A" : "B"}農園`, passwordHash: hash })) });
      await tx.producer.createMany({ data: ["a", "b"].map(key => ({ id: id(`p-${key}`), ownerUserId: id(key), farmName: `動作確認用${key.toUpperCase()}農園`, originPrefecture: "大阪府" })) });
      await tx.item.create({ data: { id: id("item"), name: "動作確認用トマト" } });
      await tx.variety.create({ data: { id: id("variety"), itemId: id("item"), name: "検証用" } });
      await tx.place.create({ data: { id: id("place"), name: "動作確認用の受取拠点", address: "架空の拠点（検証後に削除）" } });
      await tx.handoverSlot.create({ data: { id: id("slot"), placeId: id("place"), label: "動作確認枠", startAt, endAt: new Date(startAt.getTime() + 3600_000), confirmDeadlineAt: new Date(startAt.getTime() - 12 * 3600_000), feeYen: 800, feeConfirmed: true, maxKg: 20, conditionsConfirmed: true } });
      for (const key of ["a", "b"]) {
        await tx.slotParticipant.create({ data: { slotId: id("slot"), producerId: id(`p-${key}`), confirmed: true } });
        await tx.supply.create({ data: { id: id(`s-${key}`), producerId: id(`p-${key}`), itemId: id("item"), varietyId: id("variety"), originPrefecture: "大阪府", availableKg: 5, priceYenPerKg: 600, minKg: 1, slotId: id("slot"), published: true } });
      }
    }, { timeout: 30_000 });
    const cookies: Record<string, string> = {};
    for (const key of ["r", "r2", "a", "b"]) {
      const login = await call("/api/auth/login", "POST", { loginId: `demo-${id(key)}`, password });
      check(login.status === 200 && login.cookie, `real login ${key}`); cookies[key] = login.cookie!;
    }
    const request = { itemId: id("item"), varietyId: null, quantityKg: 10, desiredDate: nextDay, budgetYen: null, originPrefectures: ["大阪府"], slotId: id("slot"), allowIrregular: false, allowMixedVarieties: false, allowMixedGrades: false, allowFirstTime: true, preferredProducerId: null };
    const plan = await call("/api/plan", "POST", request, cookies.r);
    check(plan.status === 200 && plan.data.plan.status === "MATCHED" && plan.data.plan.allocations.length === 2, "server plan combines A5kg + B5kg");
    const payload = { request, version: plan.data.version, fingerprint: plan.data.fingerprint };
    check((await call("/api/approvals", "POST", payload)).status === 401, "anonymous creation denied");
    check((await call("/api/approvals", "POST", payload, cookies.a)).status === 403, "producer cannot create restaurant requests");
    const [first, repeated] = await Promise.all([call("/api/approvals", "POST", payload, cookies.r), call("/api/approvals", "POST", payload, cookies.r)]);
    check(first.status === 200 && repeated.status === 200 && first.data.requests.map((r: any) => r.id).sort().join() === repeated.data.requests.map((r: any) => r.id).sort().join(), "concurrent duplicate sends return same request IDs");
    check(await prisma.approvalRequest.count({ where: { restaurantId: id("r") } }) === 2, "exactly two rows persisted");
    const a = first.data.requests.find((r: any) => r.supplyId === id("s-a"));
    const b = first.data.requests.find((r: any) => r.supplyId === id("s-b"));
    check((await call(`/api/approvals/${a.id}`, "GET", undefined, cookies.r)).status === 403, "contact denied before approval");
    check((await call(`/api/approvals/${a.id}`, "PATCH", { status: "approved" }, cookies.b)).status === 404, "other producer cannot respond");
    check((await call(`/api/approvals/${a.id}`, "GET", undefined, cookies.r2)).status === 404, "other restaurant cannot fetch contact");
    check((await call(`/api/approvals/${a.id}`, "PATCH", { status: "approved" }, cookies.a)).status === 400, "approval requires contact registration");
    for (const key of ["a", "b"]) check((await call("/api/approvals", "PATCH", { contactPhone: "", contactEmail: `approval-check-${key}@example.invalid` }, cookies[key])).status === 200, `own contact registered ${key}`);
    check((await call(`/api/approvals/${a.id}`, "PATCH", { status: "approved" }, cookies.a)).status === 200, "own producer approves");
    const mixed = await call(`/api/approvals?fingerprint=${payload.fingerprint}`, "GET", undefined, cookies.r);
    check(overallConfirmation(mixed.data.requests) === "確認中" && !JSON.stringify(mixed.data).includes("example.invalid"), "mixed pending state excludes contact details");
    const contact = await call(`/api/approvals/${a.id}`, "GET", undefined, cookies.r);
    check(contact.status === 200 && contact.data.contact.contactEmail === "approval-check-a@example.invalid", "approved producer contact revealed");
    check((await call(`/api/approvals/${b.id}`, "PATCH", { status: "rejected" }, cookies.b)).status === 200, "producer rejects");
    const rejected = await call(`/api/approvals?fingerprint=${payload.fingerprint}`, "GET", undefined, cookies.r);
    check(overallConfirmation(rejected.data.requests) === "一部NG" && (await call(`/api/approvals/${b.id}`, "GET", undefined, cookies.r)).status === 403, "partial NG and rejected contact denied");
    const req9 = { ...request, quantityKg: 9 };
    const plan9 = await call("/api/plan", "POST", req9, cookies.r);
    const payload9 = { request: req9, version: plan9.data.version, fingerprint: plan9.data.fingerprint };
    const fresh9 = await call("/api/approvals", "POST", payload9, cookies.r);
    check(fresh9.data.requests.every((r: any) => r.status === "pending"), "changed quantity needs new approval");
    for (const row of fresh9.data.requests) {
      const key = row.supplyId === id("s-a") ? "a" : "b";
      check((await call(`/api/approvals/${row.id}`, "PATCH", { status: "approved" }, cookies[key])).status === 200, `new plan approved ${key}`);
    }
    const all = await call(`/api/approvals?fingerprint=${payload9.fingerprint}`, "GET", undefined, cookies.r);
    check(overallConfirmation(all.data.requests) === "全員承認済", "all-approved aggregate");
    const supplies = await prisma.supply.findMany({ where: { id: { in: [id("s-a"), id("s-b")] } } });
    check(supplies.every(s => s.availableKg === 5 && s.version === 1), "requests and approvals never reserve or decrement stock");
    const change = await call(`/api/supplies/${id("s-a")}`, "PATCH", { version: 1, availableKg: 4 }, cookies.a);
    check(change.status === 200, "producer inventory update");
    const oldA = fresh9.data.requests.find((r: any) => r.supplyId === id("s-a"));
    check((await call(`/api/approvals/${oldA.id}`, "GET", undefined, cookies.r)).status === 409, "stale approved contact denied");
    check((await call("/api/approvals", "POST", payload9, cookies.r)).status === 409, "stale send denied");
    const stale = await call(`/api/approvals?fingerprint=${payload9.fingerprint}`, "GET", undefined, cookies.r);
    check(stale.data.requests.every((r: any) => r.status === "stale"), "old approvals displayed as invalid");
    const replanned = await call("/api/plan", "POST", req9, cookies.r);
    const fresh = await call("/api/approvals", "POST", { request: req9, version: replanned.data.version, fingerprint: replanned.data.fingerprint }, cookies.r);
    check(fresh.status === 200 && fresh.data.requests.every((r: any) => r.status === "pending"), "recalculation never transfers approval");
    check((await call(`/api/supplies/${id("s-a")}`, "PATCH", { version: change.data.supply.version, availableKg: 5 }, cookies.a)).status === 200, "restore isolated fixture for browser check");
    await prisma.approvalRequest.deleteMany({ where: { restaurantId: id("r") } });
    console.log("API/DB flow verified. Isolated fixtures remain for browser verification; run --cleanup afterward.");
  }
} finally { await prisma.$disconnect(); }
