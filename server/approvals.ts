import type { SessionUser } from "./repo.js";
import { prisma } from "./db.js";
import type { ApprovalRequest, Prisma } from "./generated/prisma/client.js";
import { allocatePlan } from "../src/lib/allocate.js";
import { parsePlanRequest } from "../src/lib/validate.js";
import { loadPlanInputs } from "./plan-data.js";
import { planFingerprint } from "./plan-fingerprint.js";
import { serverNow } from "./clock.js";
import { handle, json } from "./http.js";
import type { Confirmation, Contact } from "../src/lib/approvals.js";

export class ApprovalProblem extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const approvalHandle = (fn: (request: Request) => Promise<Response>) => handle(async request => {
  try { return await fn(request); }
  catch (e) { if (e instanceof ApprovalProblem) return json({ error: e.message }, e.status); throw e; }
});
const conflict = () => new ApprovalProblem(409, "在庫や条件が変わりました。仕入れ案を計算し直して、再確認してください");
const notFound = () => new ApprovalProblem(404, "相談が見つかりません");
type Tx = Prisma.TransactionClient;

async function serial<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try { return await prisma.$transaction(fn, { isolationLevel: "Serializable", timeout: 30_000 }); }
    catch (e) {
      if (typeof e === "object" && e !== null && "code" in e && e.code === "P2034") {
        if (retry < 2) continue;
        throw conflict();
      }
      throw e;
    }
  }
}

type Snapshots = Map<string, Promise<Awaited<ReturnType<typeof loadPlanInputs>>>>;
async function currentPlan(tx: Tx, raw: unknown, restaurantId: string, snapshots?: Snapshots) {
  const now = serverNow();
  const parsed = parsePlanRequest(raw, now);
  if (!parsed.ok) throw conflict();
  const request = parsed.value;
  const scope = `${restaurantId}:${request.itemId}:${request.slotId}`;
  const snapshot = snapshots?.get(scope) ?? loadPlanInputs({ itemId: request.itemId, slotId: request.slotId, restaurantUserId: restaurantId }, tx);
  snapshots?.set(scope, snapshot);
  const { inputs, version } = await snapshot;
  const plan = allocatePlan({ ...inputs, request, now });
  if (plan.status !== "MATCHED" || !plan.slot || now >= new Date(plan.slot.confirmDeadlineAt)) throw conflict();
  return { request, plan, version, fingerprint: planFingerprint(request, version, plan) };
}

async function isCurrent(tx: Tx, row: ApprovalRequest, snapshots?: Snapshots) {
  try {
    const cur = await currentPlan(tx, row.planRequest, row.restaurantId, snapshots);
    return cur.version === row.planVersion && cur.fingerprint === row.planFingerprint;
  } catch (e) { if (e instanceof ApprovalProblem) return false; throw e; }
}

const listInclude = { restaurant: { select: { displayName: true } }, producer: { select: { farmName: true } } } as const;
type Listed = ApprovalRequest & { restaurant: { displayName: string }; producer: { farmName: string } };
function view(row: Listed, current: boolean): Confirmation {
  return {
    id: row.id, supplyId: row.supplyId, producerName: row.producer.farmName, restaurantName: row.restaurant.displayName,
    planFingerprint: row.planFingerprint, itemName: row.itemName, quantityKg: row.quantityKg,
    priceYenPerKg: row.priceYenPerKg, subtotalYen: row.subtotalYen,
    pickupStartAt: row.pickupStartAt.toISOString(), pickupEndAt: row.pickupEndAt.toISOString(), pickupPlace: row.pickupPlace,
    status: current ? row.status : "stale", createdAt: row.createdAt.toISOString(),
  };
}

export const approvals = {
  async create(user: SessionUser, body: unknown) {
    if (user.role !== "restaurant") throw new ApprovalProblem(403, "飲食店のみ依頼できます");
    const b = body as { request?: unknown; version?: unknown; fingerprint?: unknown } | null;
    if (!b || typeof b.version !== "string" || typeof b.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(b.fingerprint)) throw new ApprovalProblem(400, "仕入れ案を計算し直してください");
    return serial(async tx => {
      const cur = await currentPlan(tx, b.request, user.id);
      if (cur.version !== b.version || cur.fingerprint !== b.fingerprint) throw conflict();
      const item = await tx.item.findUnique({ where: { id: cur.request.itemId }, select: { name: true } });
      if (!item) throw conflict();
      // Prices, quantities and producers come exclusively from a server-recomputed plan.
      await tx.approvalRequest.createMany({
        data: cur.plan.allocations.map(a => ({
          restaurantId: user.id, producerId: a.producerId, supplyId: a.supplyId,
          planFingerprint: cur.fingerprint, planVersion: cur.version, planRequest: cur.request as unknown as Prisma.InputJsonValue,
          itemName: item.name, quantityKg: a.kg, priceYenPerKg: a.priceYenPerKg, subtotalYen: a.subtotalYen,
          pickupStartAt: new Date(cur.plan.slot!.startAt), pickupEndAt: new Date(cur.plan.slot!.endAt), pickupPlace: cur.plan.slot!.placeName,
        })), skipDuplicates: true,
      });
      const rows = await tx.approvalRequest.findMany({ where: { restaurantId: user.id, planFingerprint: cur.fingerprint }, include: listInclude, orderBy: { id: "asc" } });
      return rows.map(r => view(r, true));
    });
  },

  async list(user: SessionUser, fingerprint?: string) {
    if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) throw new ApprovalProblem(400, "確認依頼の指定が不正です");
    if (user.role === "producer" && !user.producer) return [];
    return prisma.$transaction(async tx => {
      const rows = await tx.approvalRequest.findMany({
        where: user.role === "restaurant" ? { restaurantId: user.id, ...(fingerprint && { planFingerprint: fingerprint }) } : { producerId: user.producer!.id },
        include: listInclude, orderBy: { createdAt: "desc" }, take: 100,
      });
      const freshness = new Map<string, boolean>();
      const snapshots: Snapshots = new Map();
      const result: Confirmation[] = [];
      for (const row of rows) {
        const key = `${row.restaurantId}:${row.planFingerprint}`;
        if (!freshness.has(key)) freshness.set(key, await isCurrent(tx, row, snapshots));
        result.push(view(row, freshness.get(key)!));
      }
      return result;
    }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
  },

  async respond(user: SessionUser, id: string, status: unknown) {
    if (user.role !== "producer") throw new ApprovalProblem(403, "生産者だけが返事をできます");
    if (status !== "approved" && status !== "rejected") throw new ApprovalProblem(400, "「対応できます」か「今回は対応できません」を選んでください");
    return serial(async tx => {
      const row = await tx.approvalRequest.findUnique({ where: { id }, include: listInclude });
      if (!row || row.producerId !== user.producer?.id) throw notFound();
      if (!await isCurrent(tx, row)) throw conflict();
      if (row.status !== "pending") {
        if (row.status === status) return view(row, true);
        throw new ApprovalProblem(409, "この相談にはすでに返事をしています");
      }
      if (status === "approved") {
        const contact = await tx.producer.findUnique({ where: { id: row.producerId }, select: { contactPhone: true, contactEmail: true } });
        if (!contact?.contactPhone && !contact?.contactEmail) throw new ApprovalProblem(400, "「対応できます」と返事をする前に、飲食店に伝える連絡先を登録してください");
      }
      const changed = await tx.approvalRequest.updateMany({ where: { id, status: "pending" }, data: { status, respondedAt: new Date() } });
      if (changed.count !== 1) throw new ApprovalProblem(409, "すでに返事が届いています。画面を再読み込みしてください");
      return view({ ...row, status }, true);
    });
  },

  async contact(user: SessionUser, id: string): Promise<Contact> {
    if (user.role !== "restaurant") throw new ApprovalProblem(403, "依頼した飲食店のみ確認できます");
    return serial(async tx => {
      const row = await tx.approvalRequest.findUnique({ where: { id } });
      if (!row || row.restaurantId !== user.id) throw notFound();
      if (row.status !== "approved") throw new ApprovalProblem(403, "生産者が「対応できます」と返事をした後に、連絡先を確認できます");
      if (!await isCurrent(tx, row)) throw conflict();
      const contact = await tx.producer.findUnique({ where: { id: row.producerId }, select: { contactPhone: true, contactEmail: true } });
      if (!contact) throw notFound();
      return contact;
    });
  },
};

export function parseContact(body: unknown): Contact {
  if (!body || typeof body !== "object") throw new ApprovalProblem(400, "連絡先を入力してください");
  const b = body as Record<string, unknown>;
  if (typeof b.contactPhone !== "string" || typeof b.contactEmail !== "string") throw new ApprovalProblem(400, "連絡先の形式が不正です");
  const phone = b.contactPhone.trim();
  const email = b.contactEmail.trim();
  if (phone && (!/^\+?[0-9 ()-]{6,24}$/.test(phone) || phone.replace(/\D/g, "").length < 6)) throw new ApprovalProblem(400, "電話番号を確認してください");
  if (email && (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email))) throw new ApprovalProblem(400, "メールアドレスを確認してください");
  if (!phone && !email) throw new ApprovalProblem(400, "電話番号かメールアドレスを1つ登録してください");
  return { contactPhone: phone || null, contactEmail: email || null };
}
