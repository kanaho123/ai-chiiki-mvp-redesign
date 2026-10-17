import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { json } from "./http.js";
import { repo, type Role, type SessionUser } from "./repo.js";

// ログイン・セッション・権限確認。権限は必ずサーバー側で判定する（画面でボタンを隠すだけにしない）。

// ---------------------------------------------------------------------------
// パスワード（scrypt）。平文は保存しない
// ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** 形式: scrypt$N$r$p$<salt base64url>$<hash base64url> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = stored?.split("$") ?? [];
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    // ユーザーが存在しない場合も同程度の時間をかけて、存在の有無を応答時間から推測されにくくする
    await scrypt(password, randomBytes(16), SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return false;
  }
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------------------
// セッション（HMAC 署名付き Cookie）。中身は userId・role・期限だけ
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "aic_session";
export const SESSION_TTL_SEC = 8 * 60 * 60;

type SessionPayload = { uid: string; role: Role; exp: number }; // exp はミリ秒

function secret(env: Record<string, string | undefined> = process.env): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET が未設定か短すぎます");
  return s;
}

const sign = (data: string, key: string) => createHmac("sha256", key).update(data).digest("base64url");

export function createSessionToken(user: { id: string; role: Role }, now: Date, key = secret()): string {
  const payload: SessionPayload = { uid: user.id, role: user.role, exp: now.getTime() + SESSION_TTL_SEC * 1000 };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, key)}`;
}

/** 署名・期限・形式を検証して中身を返す。少しでもおかしければ null */
export function verifySessionToken(token: string | null | undefined, now: Date, key = secret()): SessionPayload | null {
  if (!token) return null;
  const [data, sig, extra] = token.split(".");
  if (!data || !sig || extra !== undefined) return null;
  const a = createHash("sha256").update(sign(data, key)).digest();
  const b = createHash("sha256").update(sig).digest();
  if (!timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (typeof p.uid !== "string" || (p.role !== "restaurant" && p.role !== "producer") || typeof p.exp !== "number") return null;
    return p.exp > now.getTime() ? p : null;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

const secureCookie = (env: Record<string, string | undefined> = process.env) => !!env.VERCEL_ENV || env.NODE_ENV === "production";

export function sessionCookie(token: string, env?: Record<string, string | undefined>): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}${secureCookie(env) ? "; Secure" : ""}`;
}

export function clearSessionCookie(env?: Record<string, string | undefined>): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(env) ? "; Secure" : ""}`;
}

// ---------------------------------------------------------------------------
// 権限確認（API から使う）。拒否するときは Response を返す
// ---------------------------------------------------------------------------

type Guard<T> = { ok: true; user: T } | { ok: false; response: Response };

/** 別サイトからの状態変更リクエストを拒否する（SameSite=Lax に加えた確認） */
function crossSite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

export async function currentUser(request: Request, now = new Date()): Promise<SessionUser | null> {
  const s = verifySessionToken(readCookie(request, SESSION_COOKIE), now);
  if (!s) return null;
  const user = await repo.findSessionUser(s.uid);
  // DB 上のロールが変わっていたらセッションを無効とみなす
  return user && user.role === s.role ? user : null;
}

export async function requireUser(request: Request): Promise<Guard<SessionUser>> {
  if (crossSite(request)) return { ok: false, response: json({ error: "このリクエストは受け付けられません" }, 403) };
  const user = await currentUser(request);
  return user ? { ok: true, user } : { ok: false, response: json({ error: "ログインしてください" }, 401) };
}

/** 初回のプロフィール登録（オンボーディング）を終えたユーザーだけ。デモ用アカウントは常に登録済み扱い。
 *  プロフィール登録の API そのものは requireUser を使う */
export async function requireOnboardedUser(request: Request): Promise<Guard<SessionUser>> {
  const g = await requireUser(request);
  if (!g.ok) return g;
  if (!g.user.onboarded) return { ok: false, response: json({ error: "はじめにプロフィールを登録してください", code: "onboarding-required" }, 403) };
  return g;
}

/** 初回登録（オンボーディング）の API 専用：ログイン済みで、指定のロールであること（登録前でも通す）。
 *  ほかの API では使わない（ロール別の API は requireRole で登録済みを求める） */
export async function requireOnboardingUser<R extends Role>(request: Request, role: R): Promise<Guard<SessionUser & { role: R }>> {
  const g = await requireUser(request);
  if (!g.ok) return g;
  if (g.user.role !== role) return { ok: false, response: json({ error: "この操作を行う権限がありません" }, 403) };
  return g as Guard<SessionUser & { role: R }>;
}

/** ロールの確認。オンボーディング前のユーザーはどのロールの操作も使えない */
export async function requireRole<R extends Role>(request: Request, role: R): Promise<Guard<SessionUser & { role: R }>> {
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g;
  if (g.user.role !== role) return { ok: false, response: json({ error: "この操作を行う権限がありません" }, 403) };
  return g as Guard<SessionUser & { role: R }>;
}

/** 生産者本人の供給であることを確認する（他の生産者の供給 ID を直接送られても拒否） */
export async function requireOwnSupply(user: SessionUser, supplyId: string): Promise<{ ok: true } | { ok: false; response: Response }> {
  const s = await repo.findSupplyOwner(supplyId);
  if (!s) return { ok: false, response: json({ error: "供給が見つかりません" }, 404) };
  if (!user.producer || s.producerId !== user.producer.id) return { ok: false, response: json({ error: "この供給を変更する権限がありません" }, 403) };
  return { ok: true };
}
