import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser, SupplyView } from "./repo.js";

// API の権限・競合のテスト。DB の代わりにメモリ上のデータを使う（実 DB には接続しない）。

const db = vi.hoisted(() => ({
  users: new Map<string, { id: string; loginId: string; passwordHash: string | null; role: "restaurant" | "producer"; displayName: string; producerId: string | null }>(),
  supplies: new Map<string, { id: string; producerId: string; availableKg: number; published: boolean; version: number }>(),
  throttles: new Map<string, { failures: number; firstAt: number; lockedUntil: number | null }>(),
}));

vi.mock("./repo.js", () => {
  const view = (s: { id: string; producerId: string; availableKg: number; published: boolean; version: number }): SupplyView => ({
    id: s.id, producerId: s.producerId, item: { id: "tomato", name: "トマト" }, variety: { id: "v1", name: "品種T" }, grade: "regular",
    irregularReason: null, originPrefecture: "大阪府", availableKg: s.availableKg, priceYenPerKg: 600, minKg: 1,
    slot: { id: "gp", label: "G-P", placeName: "P", startAt: "2026-10-23T01:00:00.000Z", endAt: "2026-10-23T02:00:00.000Z" },
    published: s.published, version: s.version, updatedAt: "2026-10-22T00:00:00.000Z",
  });
  const sessionUser = (id: string): SessionUser | null => {
    const u = db.users.get(id);
    if (!u) return null;
    return { id: u.id, role: u.role, displayName: u.displayName, producer: u.producerId ? { id: u.producerId, farmName: u.displayName, originPrefecture: "大阪府" } : null, onboarded: true };
  };
  return {
    repo: {
      findLoginUser: async (loginId: string) => [...db.users.values()].find((u) => u.loginId === loginId) ?? null,
      findSessionUser: async (id: string) => sessionUser(id),
      listOwnSupplies: async (producerId: string) => [...db.supplies.values()].filter((s) => s.producerId === producerId).map(view),
      findSupplyOwner: async (id: string) => db.supplies.get(id) ?? null,
      getSupply: async (id: string) => (db.supplies.has(id) ? view(db.supplies.get(id)!) : null),
      updateSupplyIfVersion: async (id: string, version: number, data: { availableKg?: number; published?: boolean }) => {
        const s = db.supplies.get(id);
        if (!s || s.version !== version) return null;
        Object.assign(s, data, { version: s.version + 1 });
        return view(s);
      },
      // ログイン失敗の記録（本物は DB。ここでは同じ規則をメモリで再現）
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
      producerSlots: async () => [],
      itemsWithVarieties: async () => [],
      createSupply: async () => null,
    },
  };
});
vi.mock("./plan-data.js", () => ({
  loadPlanInputs: async () => ({ inputs: { supplies: [], slot: null, participants: [], relationships: [] }, version: "v" }),
}));

const { hashPassword, createSessionToken } = await import("./auth.js");
const login = await import("../api/auth/login.js");
const logout = await import("../api/auth/logout.js");
const me = await import("../api/me.js");
const supplies = await import("../api/supplies/index.js");
const supplyById = await import("../api/supplies/[id].js");
const plan = await import("../api/plan.js");

const PASSWORD = "テスト用のパスワード";
const BASE = "http://localhost:5180";

beforeAll(async () => {
  process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghijklmnop";
  const hash = await hashPassword(PASSWORD);
  db.users.set("u-r", { id: "u-r", loginId: "demo-r", passwordHash: hash, role: "restaurant", displayName: "飲食店R", producerId: null });
  db.users.set("u-a", { id: "u-a", loginId: "demo-a", passwordHash: hash, role: "producer", displayName: "A農園", producerId: "p-a" });
  db.users.set("u-b", { id: "u-b", loginId: "demo-b", passwordHash: hash, role: "producer", displayName: "B農園", producerId: "p-b" });
});

beforeEach(() => {
  db.throttles.clear();
  db.supplies.clear();
  db.supplies.set("s-a", { id: "s-a", producerId: "p-a", availableKg: 10, published: true, version: 3 });
  db.supplies.set("s-b", { id: "s-b", producerId: "p-b", availableKg: 5, published: true, version: 1 });
});

const cookieOf = (userId: string) => {
  const u = db.users.get(userId)!;
  return `aic_session=${createSessionToken({ id: u.id, role: u.role }, new Date())}`;
};
const req = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  new Request(BASE + path, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const patchSupply = (id: string, body: unknown, cookie?: string) => supplyById.PATCH(req(`/api/supplies/${id}`, { method: "PATCH", body, cookie }));

describe("ログイン・権限（Phase 3 セキュリティテスト）", () => {
  it("A: 未ログインで /api/supplies は拒否（401）", async () => {
    expect((await supplies.GET(req("/api/supplies"))).status).toBe(401);
    expect((await patchSupply("s-a", { version: 3, availableKg: 5 })).status).toBe(401);
    expect(db.supplies.get("s-a")!.availableKg).toBe(10);
  });

  it("B: 飲食店ユーザーが供給を更新しようとすると拒否（403）", async () => {
    const r = await patchSupply("s-a", { version: 3, availableKg: 5 }, cookieOf("u-r"));
    expect(r.status).toBe(403);
    expect((await supplies.GET(req("/api/supplies", { cookie: cookieOf("u-r") }))).status).toBe(403);
    expect(db.supplies.get("s-a")!.availableKg).toBe(10);
  });

  it("C: A農園ユーザーは自分の供給を更新でき、version が +1 される", async () => {
    const r = await patchSupply("s-a", { version: 3, availableKg: 5 }, cookieOf("u-a"));
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.supply).toMatchObject({ availableKg: 5, version: 4 });
    expect(d.before).toEqual({ availableKg: 10, published: true });
    // 公開停止は削除ではなく published=false。数量0とは別状態
    const p = await patchSupply("s-a", { version: 4, published: false }, cookieOf("u-a"));
    expect((await p.json()).supply).toMatchObject({ availableKg: 5, published: false, version: 5 });
    expect(db.supplies.has("s-a")).toBe(true);
  });

  it("C': 一覧は本人の供給だけを返す", async () => {
    const d = await (await supplies.GET(req("/api/supplies", { cookie: cookieOf("u-a") }))).json();
    expect(d.supplies.map((s: SupplyView) => s.id)).toEqual(["s-a"]);
  });

  it("D: A農園ユーザーが B農園の供給 ID を直接送って更新しようとすると拒否（403）", async () => {
    const r = await patchSupply("s-b", { version: 1, availableKg: 0 }, cookieOf("u-a"));
    expect(r.status).toBe(403);
    expect(db.supplies.get("s-b")).toMatchObject({ availableKg: 5, version: 1 });
  });

  it("E: 古い version での更新は上書きせず 409", async () => {
    db.supplies.get("s-a")!.version = 4; // 別の画面で先に更新された
    const r = await patchSupply("s-a", { version: 3, availableKg: 5 }, cookieOf("u-a"));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("情報が更新されています。最新情報を読み込み直してください");
    expect(db.supplies.get("s-a")).toMatchObject({ availableKg: 10, version: 4 });
  });

  it("数量は 0〜100kg の整数だけ受け付ける", async () => {
    for (const kg of [-1, 101, 2.5, "たくさん"]) expect((await patchSupply("s-a", { version: 3, availableKg: kg }, cookieOf("u-a"))).status).toBe(400);
    expect((await patchSupply("s-a", { version: 3, availableKg: 0 }, cookieOf("u-a"))).status).toBe(200);
    expect(db.supplies.get("s-a")).toMatchObject({ availableKg: 0, published: true });
  });

  it("F: 正しいログインで HttpOnly Cookie を発行し、ハッシュ等は返さない", async () => {
    const r = await login.POST(req("/api/auth/login", { method: "POST", body: { loginId: "demo-a", password: PASSWORD } }));
    expect(r.status).toBe(200);
    const setCookie = r.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^aic_session=[^;]+; HttpOnly; SameSite=Lax; Path=\//);
    const body = await r.text();
    expect(body).not.toMatch(/scrypt|passwordHash|SESSION_SECRET/);
    expect(JSON.parse(body).user).toMatchObject({ id: "u-a", role: "producer" });
    // 発行された Cookie で /api/me が通る
    const token = setCookie.split(";")[0];
    expect((await me.GET(req("/api/me", { cookie: token }))).status).toBe(200);
  });

  it("G: 間違ったパスワード・存在しないユーザーは同じ 401（理由を区別しない）", async () => {
    const wrong = await login.POST(req("/api/auth/login", { method: "POST", body: { loginId: "demo-a", password: "ちがう" } }));
    const none = await login.POST(req("/api/auth/login", { method: "POST", body: { loginId: "nobody", password: PASSWORD } }));
    expect([wrong.status, none.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual({ error: "ログイン情報を確認してください" });
    expect(await none.json()).toEqual({ error: "ログイン情報を確認してください" });
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("H: 改ざんした Cookie（role を書き換え・署名を壊す）は拒否", async () => {
    const [data, sig] = cookieOf("u-a").replace("aic_session=", "").split(".");
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, role: "restaurant" })).toString("base64url");
    expect((await me.GET(req("/api/me", { cookie: `aic_session=${forged}.${sig}` }))).status).toBe(401);
    expect((await me.GET(req("/api/me", { cookie: `aic_session=${data}.AAAA` }))).status).toBe(401);
    // B のユーザー ID に書き換えても署名が合わないので B として扱われない
    const asB = Buffer.from(JSON.stringify({ ...payload, uid: "u-b" })).toString("base64url");
    expect((await patchSupply("s-b", { version: 1, availableKg: 0 }, `aic_session=${asB}.${sig}`)).status).toBe(401);
  });

  it("I: ログアウト後は /api/me が 401", async () => {
    const r = await logout.POST(req("/api/auth/logout", { method: "POST", cookie: cookieOf("u-a") }));
    const cleared = (r.headers.get("set-cookie") ?? "").split(";")[0]; // ブラウザはこの空の値で Cookie を上書きする
    expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await me.GET(req("/api/me", { cookie: cleared }))).status).toBe(401);
    expect((await me.GET(req("/api/me"))).status).toBe(401);
  });

  it("J: 飲食店以外（生産者・未ログイン）が /api/plan を使うと拒否", async () => {
    expect((await plan.POST(req("/api/plan", { method: "POST", body: {}, cookie: cookieOf("u-a") }))).status).toBe(403);
    expect((await plan.POST(req("/api/plan", { method: "POST", body: {} }))).status).toBe(401);
    // 飲食店ならリクエスト検証まで進む（空の条件なので 400）
    expect((await plan.POST(req("/api/plan", { method: "POST", body: {}, cookie: cookieOf("u-r") }))).status).toBe(400);
  });

  it("別サイトからの更新リクエスト（Origin が違う）は拒否", async () => {
    const r = await supplyById.PATCH(new Request(`${BASE}/api/supplies/s-a`, {
      method: "PATCH", headers: { "Content-Type": "application/json", cookie: cookieOf("u-a"), origin: "https://evil.example" },
      body: JSON.stringify({ version: 3, availableKg: 0 }),
    }));
    expect(r.status).toBe(403);
    expect(db.supplies.get("s-a")!.availableKg).toBe(10);
  });
});

describe("ログイン試行の回数制限", () => {
  it("同じログイン名＋接続元で5回失敗すると、正しいパスワードでも一定時間 429 で受け付けない（失敗は DB に記録）", async () => {
    const attempt = (password: string) =>
      login.POST(new Request(`${BASE}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ loginId: "demo-b", password }),
      }));
    for (let i = 0; i < 5; i++) expect((await attempt("ちがう")).status).toBe(401);
    const locked = await attempt(PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("set-cookie")).toBeNull();
    // 同じ回線（接続元）でも、別のユーザーはログインできる（会場の共有回線で全員を締め出さない）
    const other = await login.POST(new Request(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ loginId: "demo-a", password: PASSWORD }),
    }));
    expect(other.status).toBe(200);
  });

  it("同じ接続元からログイン名を変えて30回失敗すると、その接続元からのログインを止める", async () => {
    const attempt = (loginId: string, password = "ちがう") =>
      login.POST(new Request(`${BASE}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "192.0.2.50" }, body: JSON.stringify({ loginId, password }),
      }));
    for (let i = 0; i < 30; i++) expect((await attempt(`guess-${i}`)).status).toBe(401);
    expect((await attempt("demo-a", PASSWORD)).status).toBe(429);
    // 別の接続元からは通常どおりログインできる（デモ用アカウント自体は締め出されない）
    const fromVenue = await login.POST(new Request(`${BASE}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.20" }, body: JSON.stringify({ loginId: "demo-a", password: PASSWORD }),
    }));
    expect(fromVenue.status).toBe(200);
  });

  it("成功したら、そのログイン名＋接続元の失敗記録を消す", async () => {
    const at = (password: string) =>
      login.POST(new Request(`${BASE}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.77" }, body: JSON.stringify({ loginId: "demo-r", password }),
      }));
    for (let i = 0; i < 4; i++) await at("ちがう");
    expect((await at(PASSWORD)).status).toBe(200);
    expect(db.throttles.has("demo-r|203.0.113.77")).toBe(false);
    expect((await at("ちがう")).status).toBe(401); // 数え直しなので、すぐにはロックされない
  });
});
