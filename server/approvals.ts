import type { SessionUser } from "./repo.js";
import { prisma } from "./db.js";
import type { ApprovalRequest, Prisma } from "./generated/prisma/client.js";
import { allocatePlan } from "../src/lib/allocate.js";
import { parsePlanRequest } from "../src/lib/validate.js";
import { loadPlanInputs } from "./plan-data.js";
import { planFingerprint } from "./plan-fingerprint.js";
import { serverNow } from "./clock.js";
import { handle, json } from "./http.js";
import { IntervalLimiter } from "./rate-limit.js";
import {
  REVIEW_COMMENT_MAX, TRADE_DECLINED, type Confirmation, type Contact, type MyReview, type RequestConditions, type TradeMessage, type TradeRating, type TradeReviewState,
} from "../src/lib/approvals.js";

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

/**
 * 取引の成立：同じ仕入れ案（飲食店・fingerprint）の依頼が、すべて「対応できます」になったとき。
 * 成立したら、それ以降は仕入れ案を計算し直さない（stale にしない）。保存済みの品目・数量・価格・小計・受け取りの日時と場所を、
 * その取引で合意した内容として扱う。「対応できます」の行は変わらない（respond は返事済みの行を変えない）ので、成立は取り消されない。
 * 成立までは、一部の農家だけが「対応できます」でも、今までどおり計算し直して stale を判定する。
 */
async function isEstablished(tx: Tx, restaurantId: string, fingerprint: string) {
  const rows = await tx.approvalRequest.findMany({ where: { restaurantId, planFingerprint: fingerprint }, select: { status: true } });
  return rows.length > 0 && rows.every((r) => r.status === "approved");
}

async function isCurrent(tx: Tx, row: ApprovalRequest, snapshots?: Snapshots) {
  try {
    const cur = await currentPlan(tx, row.planRequest, row.restaurantId, snapshots);
    return cur.version === row.planVersion && cur.fingerprint === row.planFingerprint;
  } catch (e) { if (e instanceof ApprovalProblem) return false; throw e; }
}

const listInclude = { restaurant: { select: { displayName: true } }, producer: { select: { farmName: true } } } as const;
type Listed = ApprovalRequest & { restaurant: { displayName: string }; producer: { farmName: string } };

/**
 * 依頼のときに保存した仕入れ条件（planRequest）のうち、相手に見せてよいものだけを取り出す。
 * 予算・優先したい農家は飲食店の内部の条件なので出さない。形が想定と違えば null（画面は条件を出さないだけ）。
 */
function requestConditions(raw: Prisma.JsonValue): RequestConditions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
  if (typeof r.quantityKg !== "number" || typeof r.desiredDate !== "string") return null;
  return {
    requestedKg: r.quantityKg, desiredDate: r.desiredDate,
    originPrefectures: Array.isArray(r.originPrefectures) ? r.originPrefectures.filter((p): p is string => typeof p === "string") : [],
    allowIrregular: bool(r.allowIrregular), allowFirstTime: bool(r.allowFirstTime),
    allowMixedVarieties: bool(r.allowMixedVarieties), allowMixedGrades: bool(r.allowMixedGrades),
  };
}

function view(row: Listed, current: boolean, established = false): Confirmation {
  return {
    id: row.id, supplyId: row.supplyId, producerName: row.producer.farmName, restaurantName: row.restaurant.displayName,
    planFingerprint: row.planFingerprint, itemName: row.itemName, quantityKg: row.quantityKg,
    priceYenPerKg: row.priceYenPerKg, subtotalYen: row.subtotalYen,
    pickupStartAt: row.pickupStartAt.toISOString(), pickupEndAt: row.pickupEndAt.toISOString(), pickupPlace: row.pickupPlace,
    status: current ? row.status : "stale", createdAt: row.createdAt.toISOString(),
    conditions: requestConditions(row.planRequest),
    established, receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
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
      const established = new Map<string, boolean>();
      const snapshots: Snapshots = new Map();
      const result: Confirmation[] = [];
      for (const row of rows) {
        const key = `${row.restaurantId}:${row.planFingerprint}`;
        if (!established.has(key)) established.set(key, await isEstablished(tx, row.restaurantId, row.planFingerprint));
        if (!freshness.has(key)) freshness.set(key, established.get(key)! || await isCurrent(tx, row, snapshots));
        result.push(view(row, freshness.get(key)!, established.get(key)!));
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
      if (!await isEstablished(tx, row.restaurantId, row.planFingerprint) && !await isCurrent(tx, row)) throw conflict();
      const contact = await tx.producer.findUnique({ where: { id: row.producerId }, select: { contactPhone: true, contactEmail: true } });
      if (!contact) throw notFound();
      return contact;
    });
  },
};

// ---------------------------------------------------------------------------
// 取引（成立後）：やり取り（テキストだけ）と受け取り完了
// ---------------------------------------------------------------------------

export const MESSAGE_MAX = 1000;
const MESSAGE_LIST_MAX = 200;
const messageLimiter = new IntervalLimiter(1000); // 連打の防止（同じユーザーは1秒に1通まで）

/** その相談の飲食店か生産者だけ。取引が成立していなければ使えない */
async function tradeRow(tx: Tx, user: SessionUser, id: string) {
  const row = await tx.approvalRequest.findUnique({ where: { id }, include: listInclude });
  const mine = row && (user.role === "restaurant" ? row.restaurantId === user.id : !!user.producer && row.producerId === user.producer.id);
  if (!row || !mine) throw notFound();
  if (row.status !== "approved" || !await isEstablished(tx, row.restaurantId, row.planFingerprint)) {
    throw new ApprovalProblem(409, "全農家が「対応できます」と返事をして取引が成立してから、やり取りできます");
  }
  return row;
}

function messageView(row: Listed, m: { id: string; body: string; createdAt: Date; senderUserId: string }, me: SessionUser): TradeMessage {
  const fromRestaurant = m.senderUserId === row.restaurantId;
  return {
    id: m.id, body: m.body, createdAt: m.createdAt.toISOString(), mine: m.senderUserId === me.id,
    sender: fromRestaurant ? "restaurant" : "producer", senderName: fromRestaurant ? row.restaurant.displayName : row.producer.farmName,
  };
}

/** 本文：文字列で、前後の空白を除いて1〜1000文字 */
export function parseMessageBody(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new ApprovalProblem(400, "メッセージを入力してください");
  if ([...text].length > MESSAGE_MAX) throw new ApprovalProblem(400, `メッセージは${MESSAGE_MAX}文字以内で入力してください`);
  return text;
}

export const trades = {
  async messages(user: SessionUser, id: string) {
    return prisma.$transaction(async (tx) => {
      const row = await tradeRow(tx, user, id);
      const list = await tx.tradeMessage.findMany({
        where: { approvalRequestId: id }, select: { id: true, body: true, createdAt: true, senderUserId: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MESSAGE_LIST_MAX,
      });
      return { messages: list.reverse().map((m) => messageView(row, m, user)), completed: !!row.receivedAt };
    });
  },

  async send(user: SessionUser, id: string, raw: unknown) {
    const body = parseMessageBody(raw);
    if (!messageLimiter.take(user.id)) throw new ApprovalProblem(429, "少し時間をおいてから送ってください");
    return prisma.$transaction(async (tx) => {
      const row = await tradeRow(tx, user, id);
      if (row.receivedAt) throw new ApprovalProblem(409, "この取引は完了しています");
      const m = await tx.tradeMessage.create({ data: { approvalRequestId: id, senderUserId: user.id, body }, select: { id: true, body: true, createdAt: true, senderUserId: true } });
      return messageView(row, m, user);
    });
  },

  /**
   * 受け取り完了（＝取引完了）。飲食店が仕入れ案ごとに1回押す。同じ仕入れ案の「対応できます」の行すべてに、同じ時刻を1つのトランザクションで入れる。
   * もう一度押しても同じ結果（すでに入っている時刻を使い、変えない）。取引が成立していなければ完了できない。
   * MVP の判断：予定の受け取り日時より前でも押せる（早めの受け渡しも許す）。受け取り時刻の制御・キャンセルなどは将来の課題。
   */
  async received(user: SessionUser, fingerprint: unknown) {
    if (user.role !== "restaurant") throw new ApprovalProblem(403, "依頼した飲食店のみ操作できます");
    if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new ApprovalProblem(400, "相談の指定が不正です");
    return serial(async (tx) => {
      const rows = await tx.approvalRequest.findMany({ where: { restaurantId: user.id, planFingerprint: fingerprint }, include: listInclude, orderBy: { id: "asc" } });
      if (rows.length === 0) throw notFound();
      if (rows.some((r) => r.status === "rejected")) throw new ApprovalProblem(409, TRADE_DECLINED);
      if (!rows.every((r) => r.status === "approved")) throw new ApprovalProblem(409, "まだ取引が成立していません。全農家の返事を待ってください");
      const at = rows.find((r) => r.receivedAt)?.receivedAt ?? new Date();
      await tx.approvalRequest.updateMany({ where: { restaurantId: user.id, planFingerprint: fingerprint, status: "approved", receivedAt: null }, data: { receivedAt: at } });
      return rows.map((r) => view({ ...r, receivedAt: at }, true, true));
    });
  },
};

// ---------------------------------------------------------------------------
// 取引の後：評価（飲食店・生産者がそれぞれ1回）と「いつもの農家」（飲食店だけ）
// どちらも受け取り完了（receivedAt あり）の取引だけ。保存と本人への表示だけで、マッチング・Relationship には使わない
// ---------------------------------------------------------------------------

/** その相談の飲食店か生産者で、受け取りまで完了した取引だけ */
async function completedRow(tx: Tx, user: SessionUser, id: string) {
  const row = await tradeRow(tx, user, id);
  if (!row.receivedAt) throw new ApprovalProblem(409, "受け取りが完了した取引だけ、評価や「いつもの農家」の登録ができます");
  return row;
}

/** 評価：「良かった」「残念だった」のどちらかと、任意の一言（前後の空白を除いて100文字まで。空なら保存しない） */
export function parseReview(raw: unknown): { rating: TradeRating; comment: string | null } {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (b.rating !== "good" && b.rating !== "bad") throw new ApprovalProblem(400, "「良かった」か「残念だった」を選んでください");
  if (b.comment !== undefined && b.comment !== null && typeof b.comment !== "string") throw new ApprovalProblem(400, "一言コメントの形式が正しくありません");
  const comment = typeof b.comment === "string" ? b.comment.trim() : "";
  if ([...comment].length > REVIEW_COMMENT_MAX) throw new ApprovalProblem(400, `一言コメントは${REVIEW_COMMENT_MAX}文字以内で入力してください`);
  return { rating: b.rating, comment: comment || null };
}

const reviewView = (r: { rating: TradeRating; comment: string | null; createdAt: Date }): MyReview => ({ rating: r.rating, comment: r.comment, createdAt: r.createdAt.toISOString() });

export const reviews = {
  /** 自分の評価（相手の評価は返さない）と、飲食店なら「いつもの農家」に登録済みか */
  async get(user: SessionUser, id: string): Promise<TradeReviewState> {
    return prisma.$transaction(async (tx) => {
      const row = await completedRow(tx, user, id);
      const mine = await tx.tradeReview.findUnique({ where: { approvalRequestId_reviewerRole: { approvalRequestId: id, reviewerRole: user.role } } });
      const usual = user.role === "restaurant"
        ? !!await tx.usualProducer.findUnique({ where: { restaurantUserId_producerId: { restaurantUserId: user.id, producerId: row.producerId } } })
        : null;
      return { review: mine && reviewView(mine), usual };
    });
  },

  /** 評価は同じ相談・同じ側から1回だけ（変更・取り消しはしない） */
  async create(user: SessionUser, id: string, raw: unknown): Promise<MyReview> {
    const input = parseReview(raw);
    return serial(async (tx) => {
      await completedRow(tx, user, id);
      const exists = await tx.tradeReview.findUnique({ where: { approvalRequestId_reviewerRole: { approvalRequestId: id, reviewerRole: user.role } } });
      if (exists) throw new ApprovalProblem(409, "この取引はすでに評価しています");
      const r = await tx.tradeReview.create({ data: { approvalRequestId: id, reviewerRole: user.role, reviewerUserId: user.id, ...input } });
      return reviewView(r);
    }).catch((e) => {
      // 同時に2回送られたとき（一意制約）も「評価済み」として扱う
      if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") throw new ApprovalProblem(409, "この取引はすでに評価しています");
      throw e;
    });
  },

  /** 「いつもの農家」に登録。受け取りまで完了した取引の農家だけ。登録済みならそのまま（最初の登録を残す） */
  async markUsual(user: SessionUser, id: string): Promise<{ usual: true }> {
    if (user.role !== "restaurant") throw new ApprovalProblem(403, "飲食店だけが登録できます");
    return serial(async (tx) => {
      const row = await completedRow(tx, user, id);
      await tx.usualProducer.createMany({ data: [{ restaurantUserId: user.id, producerId: row.producerId, approvalRequestId: id }], skipDuplicates: true });
      return { usual: true };
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
