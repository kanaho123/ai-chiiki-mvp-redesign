import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./repo.js";

// 一般ユーザーの新規登録・メールアドレスでのログイン・権限のテスト。DB の代わりにメモリ上のデータを使う（実 DB には接続しない）。

type MemUser = {
  id: string; loginId: string; email: string | null; passwordHash: string | null; role: "restaurant" | "producer";
  legalAcceptedAt: Date | null; termsVersion: string | null; privacyVersion: string | null; onboardedAt: Date | null; producerId: string | null;
};
const db = vi.hoisted(() => ({
  users: new Map<string, MemUser>(),
  throttles: new Map<string, { failures: number; firstAt: number; lockedUntil: number | null }>(),
  forcedLoginIdConflicts: 0,
  triedLoginIds: [] as string[],
  seq: 0,
}));

vi.mock("./repo.js", () => {
  const sessionUser = (id: string): SessionUser | null => {
    const u = db.users.get(id);
    if (!u) return null;
    return {
      id: u.id, role: u.role, displayName: "（未設定）",
      producer: u.producerId ? { id: u.producerId, farmName: "農園", originPrefecture: "大阪府" } : null,
      onboarded: process.env.APP_MODE === "demo" || u.onboardedAt !== null,
    };
  };
  return {
    repo: {
      findLoginUser: async (loginId: string) => [...db.users.values()].find((u) => u.loginId === loginId) ?? null,
      findLoginUserByEmail: async (email: string) => [...db.users.values()].find((u) => u.email === email) ?? null,
      findSessionUser: async (id: string) => sessionUser(id),
      // 本物は DB の一意制約（email・loginId）で判定する。ここでは同じ結果をメモリで再現する
      createGeneralUser: async (data: Omit<MemUser, "id" | "onboardedAt" | "producerId">) => {
        db.triedLoginIds.push(data.loginId);
        if ([...db.users.values()].some((u) => u.email === data.email)) return { ok: false, conflict: "email" };
        if (db.forcedLoginIdConflicts > 0) { db.forcedLoginIdConflicts--; return { ok: false, conflict: "loginId" }; }
        if ([...db.users.values()].some((u) => u.loginId === data.loginId)) return { ok: false, conflict: "loginId" };
        const id = `gen-${++db.seq}`;
        db.users.set(id, { ...data, id, onboardedAt: null, producerId: null });
        return { ok: true, id };
      },
      isThrottled: async (keys: string[], now: Date) => keys.some((k) => (db.throttles.get(k)?.lockedUntil ?? 0) > now.getTime()),
      recordLoginFailure: async (key: string, now: Date, rule: { max: number; windowMs: number; lockMs: number }) => {
        const cur = db.throttles.get(key);
        const fresh = !cur || now.getTime() - cur.firstAt > rule.windowMs;
        const failures = fresh ? 1 : cur.failures + 1;
        db.throttles.set(key, {
          failures, firstAt: fresh ? now.getTime() : cur.firstAt,
          lockedUntil: failures >= rule.max ? now.getTime() + rule.lockMs : fresh ? null : cur.lockedUntil,
        });
      },
      clearLoginFailures: async (key: string) => void db.throttles.delete(key),
      listOwnSupplies: async () => [],
      producerSlots: async () => [],
      itemsWithVarieties: async () => [],
    },
  };
});

const { hashPassword } = await import("./auth.js");
const { TERMS_VERSION, PRIVACY_VERSION } = await import("./legal.js");
const { generateLoginId, normalizeEmail, parseSignup } = await import("./accounts.js");
const signup = await import("../api/auth/signup.js");
const login = await import("../api/auth/login.js");
const me = await import("../api/me.js");
const supplies = await import("../api/supplies/index.js");
const approvals = await import("../api/approvals/index.js");

const BASE = "http://localhost:5180";
const PASSWORD = "general-pass-1234";
let ipSeq = 0;
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

const post = (handler: { POST: (r: Request) => Promise<Response> }, body: unknown, ip = freshIp()) =>
  handler.POST(new Request(`${BASE}/api`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const get = (handler: { GET: (r: Request) => Promise<Response> }, cookie = "") =>
  handler.GET(new Request(`${BASE}/api`, { headers: cookie ? { cookie } : {} }));
const signupBody = (over: Record<string, unknown> = {}) => ({
  email: "Taro@Example.com", password: PASSWORD, passwordConfirm: PASSWORD, role: "restaurant", legalAccepted: true, ...over,
});

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghijklmnop";
});
beforeEach(() => {
  db.users.clear();
  db.throttles.clear();
  db.forcedLoginIdConflicts = 0;
  db.triedLoginIds = [];
  vi.stubEnv("APP_MODE", "general");
  vi.stubEnv("DEMO_NOW", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("新規登録の入力確認", () => {
  it("メールアドレスは前後の空白を除いて小文字にそろえる", () => {
    expect(normalizeEmail("  Taro@Example.COM ")).toBe("taro@example.com");
    const r = parseSignup(signupBody({ email: " Taro@Example.COM\t" }));
    expect(r.ok && r.value.email).toBe("taro@example.com");
  });
  it("誤りは欄の名前と具体的な文言で返す", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ email: "" }, "email"],
      [{ email: "taro@" }, "email"],
      [{ email: `${"a".repeat(250)}@x.jp` }, "email"],
      [{ password: "short", passwordConfirm: "short" }, "password"],
      [{ password: "x".repeat(129), passwordConfirm: "x".repeat(129) }, "password"],
      [{ password: "TARO@example.com", passwordConfirm: "TARO@example.com" }, "password"],
      [{ passwordConfirm: "別のパスワード12345" }, "passwordConfirm"],
      [{ role: "admin" }, "role"],
      [{ role: undefined }, "role"],
      [{ legalAccepted: false }, "legal"],
      [{ legalAccepted: "true" }, "legal"],
      [{ legalAccepted: undefined }, "legal"],
    ];
    for (const [over, field] of cases) {
      const r = parseSignup(signupBody(over));
      expect(r.ok, JSON.stringify(over)).toBe(false);
      if (!r.ok) {
        expect(r.field).toBe(field);
        expect(r.error.length).toBeGreaterThan(0);
      }
    }
    expect(parseSignup(null).ok).toBe(false);
  });
  it("内部用ログインIDは十分長いランダム値で、demo- では始まらない", () => {
    const ids = new Set(Array.from({ length: 200 }, generateLoginId));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id.startsWith("demo-")).toBe(false);
      expect(id).toMatch(/^u-[A-Za-z0-9_-]{32}$/);
    }
  });
});

describe("新規登録 API（general mode）", () => {
  it("登録するとログイン状態になり、メールは正規化・同意の版と日時はサーバーで記録する", async () => {
    const before = Date.now();
    const res = await post(signup, signupBody({ email: "  Hanako@Example.JP ", termsVersion: "偽の版", privacyVersion: "偽の版", legalAcceptedAt: "2000-01-01T00:00:00Z", loginId: "demo-r", onboardedAt: "2000-01-01" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe("restaurant");
    expect(body.user.onboarded).toBe(false);
    const [u] = [...db.users.values()];
    expect(u.email).toBe("hanako@example.jp");
    expect(u.termsVersion).toBe(TERMS_VERSION);
    expect(u.privacyVersion).toBe(PRIVACY_VERSION);
    expect(u.legalAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(u.legalAcceptedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(u.loginId).not.toBe("demo-r");
    expect(u.loginId.startsWith("demo-")).toBe(false);
    expect(u.passwordHash).not.toContain(PASSWORD);
    expect(u.onboardedAt).toBeNull();
    // 発行された Cookie でそのまま本人として扱われる
    const meRes = await get(me, cookieOf(res));
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.user.id).toBe(u.id);
    expect(meBody.appMode).toBe("general");
  });
  it("同じメールアドレス（大文字小文字・空白違いを含む）は 409 で、2件目は作らない", async () => {
    expect((await post(signup, signupBody({ email: "taro@example.com" }))).status).toBe(201);
    for (const email of ["taro@example.com", "TARO@EXAMPLE.COM", "  Taro@Example.com  "]) {
      const res = await post(signup, signupBody({ email }));
      expect(res.status).toBe(409);
      expect((await res.json()).field).toBe("email");
    }
    expect(db.users.size).toBe(1);
  });
  it("入力の誤りは 400 と欄の名前を返し、ユーザーは作らない", async () => {
    const res = await post(signup, signupBody({ legalAccepted: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("legal");
    expect(db.users.size).toBe(0);
  });
  it("内部用ログインIDが衝突したら別の値で作り直す", async () => {
    db.forcedLoginIdConflicts = 2;
    const res = await post(signup, signupBody());
    expect(res.status).toBe(201);
    expect(db.triedLoginIds).toHaveLength(3);
    expect(new Set(db.triedLoginIds).size).toBe(3);
    expect([...db.users.values()][0].loginId).toBe(db.triedLoginIds[2]);
  });
  it("衝突が続いたら作らずに 500（内部情報は返さない）", async () => {
    db.forcedLoginIdConflicts = 99;
    const res = await post(signup, signupBody());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/loginId|P2002|prisma/i);
    expect(db.users.size).toBe(0);
  });
  it("同じ接続元からの登録は1時間に10回まで", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < signup.SIGNUP_RULE.max; i++) {
      const res = await post(signup, signupBody({ email: `user${i}@example.com` }), ip);
      expect(res.status).toBe(201);
    }
    expect((await post(signup, signupBody({ email: "over@example.com" }), ip)).status).toBe(429);
    expect((await post(signup, signupBody({ email: "other@example.com" }))).status).toBe(201);
  });
  it("demo mode では新規登録できない（404）", async () => {
    vi.stubEnv("APP_MODE", "demo");
    const res = await post(signup, signupBody());
    expect(res.status).toBe(404);
    expect(db.users.size).toBe(0);
  });
  it("general mode に DEMO_NOW があると、登録もログインも止める（503）", async () => {
    vi.stubEnv("DEMO_NOW", "2026-10-22T09:00:00+09:00");
    expect((await post(signup, signupBody())).status).toBe(503);
    expect((await post(login, { email: "taro@example.com", password: PASSWORD })).status).toBe(503);
    expect(db.users.size).toBe(0);
  });
});

describe("メールアドレスでのログイン", () => {
  beforeEach(async () => {
    const hash = await hashPassword(PASSWORD);
    db.users.set("g-1", { id: "g-1", loginId: "u-randomvalue", email: "taro@example.com", passwordHash: hash, role: "producer", legalAcceptedAt: new Date(), termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, onboardedAt: null, producerId: null });
    db.users.set("d-r", { id: "d-r", loginId: "demo-r", email: null, passwordHash: hash, role: "restaurant", legalAcceptedAt: null, termsVersion: null, privacyVersion: null, onboardedAt: null, producerId: null });
  });
  it("大文字小文字・前後の空白が違ってもログインできる", async () => {
    const res = await post(login, { email: "  TARO@Example.com ", password: PASSWORD });
    expect(res.status).toBe(200);
    expect((await res.json()).user.id).toBe("g-1");
    expect(cookieOf(res)).toMatch(/^aic_session=/);
  });
  it("パスワード違い・存在しないメールは同じ 401 で区別しない", async () => {
    const a = await post(login, { email: "taro@example.com", password: "wrong-password" });
    const b = await post(login, { email: "nobody@example.com", password: PASSWORD });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });
  it("general mode ではデモ用ログイン名ではログインできない", async () => {
    const res = await post(login, { loginId: "demo-r", password: PASSWORD });
    expect(res.status).toBe(401);
  });
  it("demo mode ではデモ用ログイン名でログインできる", async () => {
    vi.stubEnv("APP_MODE", "demo");
    const res = await post(login, { loginId: "demo-r", password: PASSWORD });
    expect(res.status).toBe(200);
    expect((await res.json()).user.id).toBe("d-r");
  });
  it("同じメール＋接続元で5回失敗するとロックし、正しいパスワードでも 429", async () => {
    const ip = "198.51.100.9";
    for (let i = 0; i < login.LOGIN_RULES.account.max; i++) {
      expect((await post(login, { email: "taro@example.com", password: "wrong-password" }, ip)).status).toBe(401);
    }
    expect((await post(login, { email: "Taro@example.com", password: PASSWORD }, ip)).status).toBe(429);
  });
});

describe("登録直後のユーザーの権限", () => {
  it("オンボーディング前は、ロールに合った API でも使えない（onboarding-required）", async () => {
    const p = await post(signup, signupBody({ role: "producer" }));
    expect(p.status).toBe(201);
    const s = await get(supplies, cookieOf(p));
    expect(s.status).toBe(403);
    expect((await s.json()).code).toBe("onboarding-required");
    const r = await post(signup, signupBody({ email: "rest@example.com", role: "restaurant" }));
    const a = await get(approvals, cookieOf(r));
    expect(a.status).toBe(403);
    expect((await a.json()).code).toBe("onboarding-required");
    // 本人確認の /api/me は使える（画面をオンボーディングへ案内するため）
    expect((await get(me, cookieOf(r))).status).toBe(200);
  });
  it("オンボーディング後も、生産者情報が無ければ供給 API は使えない", async () => {
    const p = await post(signup, signupBody({ role: "producer" }));
    const [u] = [...db.users.values()];
    u.onboardedAt = new Date();
    const s = await get(supplies, cookieOf(p));
    expect(s.status).toBe(403);
    expect((await s.json()).code).toBeUndefined();
  });
  it("飲食店として登録したユーザーは生産者の API を使えない", async () => {
    const res = await post(signup, signupBody({ role: "restaurant" }));
    const [u] = [...db.users.values()];
    u.onboardedAt = new Date();
    const s = await get(supplies, cookieOf(res));
    expect(s.status).toBe(403);
    expect((await s.json()).error).toBe("この操作を行う権限がありません");
  });
  it("demo mode のデモ用アカウントは登録済み扱いで、これまでどおり使える", async () => {
    vi.stubEnv("APP_MODE", "demo");
    const hash = await hashPassword(PASSWORD);
    db.users.set("d-a", { id: "d-a", loginId: "demo-a", email: null, passwordHash: hash, role: "producer", legalAcceptedAt: null, termsVersion: null, privacyVersion: null, onboardedAt: null, producerId: "p-a" });
    const l = await post(login, { loginId: "demo-a", password: PASSWORD });
    expect(l.status).toBe(200);
    expect((await get(supplies, cookieOf(l))).status).toBe(200);
  });
  it("未ログインは 401", async () => {
    expect((await get(supplies)).status).toBe(401);
    expect((await get(me)).status).toBe(401);
  });
});
