import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API_FUNCTIONS, functionFor, vercelRewrites } from "./api-map";
import { createRouter } from "./router";

// Functions の統合（Vercel Hobby の上限 12 個に対して余裕をもたせる）のテスト。
// ・振り分け（メソッド＋パス）・404・405・クエリと本文とヘッダーの受け渡し
// ・vercel.json の rewrites と表（server/api-map.ts）が一致すること
// ・各 URL で、統合した Function を通しても、元の処理を直接呼んだときと同じ確認（ログイン・ロール・Origin・APP_MODE）が通ること

describe("振り分け（createRouter）", () => {
  const seen: { name: string; url: string; method: string; body: string; cookie: string | null }[] = [];
  const mod = (name: string, methods: string[]) =>
    Object.fromEntries(methods.map((m) => [m, async (r: Request) => {
      seen.push({ name, url: r.url, method: r.method, body: r.method === "GET" ? "" : await r.text(), cookie: r.headers.get("cookie") });
      return Response.json({ name });
    }]));
  const router = createRouter({ "/api/x/list": mod("list", ["GET", "POST"]), "/api/x/:id": mod("one", ["PATCH"]) });
  beforeEach(() => { seen.length = 0; });

  it("メソッドとパスで振り分け、元の URL・本文・Cookie をそのまま渡す", async () => {
    const res = await router.POST(new Request("http://h/api/x/list?a=1", { method: "POST", headers: { cookie: "s=1", "content-type": "application/json" }, body: '{"k":2}' }));
    expect(await res.json()).toEqual({ name: "list" });
    expect(seen[0]).toEqual({ name: "list", url: "http://h/api/x/list?a=1", method: "POST", body: '{"k":2}', cookie: "s=1" });
  });
  it("Vercel の rewrite で届く形（__path）でも、元の URL に戻してから渡す（__path は消す）", async () => {
    await router.PATCH(new Request("http://h/api/x?__path=/api/x/abc123&q=z", { method: "PATCH", body: "b" }));
    expect(seen[0]).toMatchObject({ name: "one", url: "http://h/api/x/abc123?q=z", body: "b" });
  });
  it("Vercel が足すクエリ（:route・:id の値）は取り除き、元のクエリだけを渡す", async () => {
    await router.PATCH(new Request("http://h/api/x?__path=%2Fapi%2Fx%2Fabc&id=abc&q=1", { method: "PATCH", body: "" }));
    expect(seen[0].url).toBe("http://h/api/x/abc?q=1");
    seen.length = 0;
    await router.GET(new Request("http://h/api/x?__path=%2Fapi%2Fx%2Flist&route=list"));
    expect(seen[0].url).toBe("http://h/api/x/list");
    seen.length = 0;
    await router.GET(new Request("http://h/api/x/list?id=keep")); // rewrite を通らない（開発サーバー）ときは触らない
    expect(seen[0].url).toBe("http://h/api/x/list?id=keep");
  });
  it("表にない URL は 404、その URL で使えないメソッドは 405（Allow を返す）", async () => {
    expect((await router.GET(new Request("http://h/api/x/list/more"))).status).toBe(404);
    expect((await router.GET(new Request("http://h/api/y"))).status).toBe(404);
    expect((await router.GET(new Request("http://h/api/x?__path=/api/zzz"))).status).toBe(404);
    expect((await router.GET(new Request("http://h/api/x?__path=/etc/passwd"))).status).toBe(404);
    expect((await router.GET(new Request("http://h/api/x?__path=/api/x/../list"))).status).toBe(404);
    const r = await router.DELETE(new Request("http://h/api/x/list", { method: "DELETE" }));
    expect(r.status).toBe(405);
    expect(r.headers.get("allow")).toBe("GET, POST");
    expect((await router.GET(new Request("http://h/api/x/abc"))).status).toBe(405);
    expect(seen).toHaveLength(0);
  });
  it("末尾の / は同じ URL として扱う", async () => {
    await router.GET(new Request("http://h/api/x/list/"));
    expect(seen[0].name).toBe("list");
  });
});

describe("Functions の数と vercel.json", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] };
  it("api/ の Function は7個（Hobby の上限12個に余裕あり）。表と同じ", () => {
    const files = readdirSync("api", { recursive: true }).map(String).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\\/g, "/"));
    expect(files.sort()).toEqual(Object.keys(API_FUNCTIONS).map((f) => `${f}.ts`).sort());
    expect(files.length).toBeLessThanOrEqual(10);
  });
  it("vercel.json の rewrites は表と一致し、/api/* を index.html へ流す fallback は最後", () => {
    expect(vercel.rewrites.slice(0, -1)).toEqual(vercelRewrites());
    expect(vercel.rewrites.at(-1)).toEqual({ source: "/((?!api(?:/|$)|assets/).*)", destination: "/index.html" });
  });
  it("これまでの URL は、すべてどれかの Function が受け持つ", () => {
    const urls = ["/api/approvals", "/api/approvals/abc", "/api/auth/demo-accounts", "/api/auth/login", "/api/auth/logout", "/api/auth/signup",
      "/api/catalog", "/api/extract", "/api/inbox", "/api/inventory-version", "/api/me", "/api/onboarding/master", "/api/onboarding/producer",
      "/api/onboarding/restaurant", "/api/plan", "/api/profile", "/api/supplies", "/api/supplies/abc"];
    expect(urls.map((u) => [u, functionFor(u)])).toEqual(urls.map((u) => [u, expect.any(String)]));
    expect(functionFor("/api/nothing")).toBeNull();
    expect(functionFor("/api/approvals/a/b")).toBeNull();
  });
});

// ── 統合しても確認が弱まらないこと：統合した Function と、元の処理を直接呼んだ結果が同じ ──
const CASES: [method: string, path: string, headers?: Record<string, string>][] = [
  ["GET", "/api/approvals"], ["PATCH", "/api/approvals"], ["POST", "/api/approvals"],
  ["GET", "/api/approvals/abc"], ["PATCH", "/api/approvals/abc"],
  ["GET", "/api/auth/demo-accounts"], ["POST", "/api/auth/login", { origin: "https://evil.example" }], ["POST", "/api/auth/logout", { origin: "https://evil.example" }],
  ["POST", "/api/auth/signup", { origin: "https://evil.example" }],
  ["GET", "/api/catalog"], ["GET", "/api/inbox"], ["GET", "/api/inventory-version"], ["GET", "/api/me"],
  ["GET", "/api/onboarding/master"], ["POST", "/api/onboarding/producer"], ["POST", "/api/onboarding/restaurant"],
  ["POST", "/api/plan"], ["GET", "/api/profile"], ["PATCH", "/api/profile"],
  ["GET", "/api/supplies"], ["POST", "/api/supplies"], ["PATCH", "/api/supplies/abc"],
  ["POST", "/api/approvals", { origin: "https://evil.example", cookie: "aic_session=x" }],
];
type Handler = (r: Request) => Promise<Response>;
const call = (mod: Record<string, unknown>, method: string, r: Request) => (mod[method] as Handler)(r);
const direct: Record<string, () => Promise<Record<string, unknown>>> = {
  "/api/approvals": () => import("./routes/approvals/index.js"), "/api/approvals/abc": () => import("./routes/approvals/[id].js"),
  "/api/auth/demo-accounts": () => import("./routes/auth/demo-accounts.js"), "/api/auth/login": () => import("./routes/auth/login.js"),
  "/api/auth/logout": () => import("./routes/auth/logout.js"), "/api/auth/signup": () => import("./routes/auth/signup.js"),
  "/api/catalog": () => import("./routes/catalog.js"), "/api/inbox": () => import("./routes/inbox.js"), "/api/inventory-version": () => import("./routes/inventory-version.js"),
  "/api/me": () => import("./routes/me.js"), "/api/onboarding/master": () => import("./routes/onboarding/master.js"),
  "/api/onboarding/producer": () => import("./routes/onboarding/producer.js"), "/api/onboarding/restaurant": () => import("./routes/onboarding/restaurant.js"),
  "/api/plan": () => import("./routes/plan.js"), "/api/profile": () => import("./routes/profile.js"),
  "/api/supplies": () => import("./routes/supplies/index.js"), "/api/supplies/abc": () => import("./routes/supplies/[id].js"),
};
const groups: Record<string, () => Promise<Record<string, unknown>>> = {
  auth: () => import("../api/auth.js"), onboarding: () => import("../api/onboarding.js"), approvals: () => import("../api/approvals.js"),
  supplies: () => import("../api/supplies.js"), account: () => import("../api/account.js"), purchase: () => import("../api/purchase.js"),
};

// 対象の処理を先に読み込んでおく（並列実行のときに最初の1件だけ読み込みで時間切れにならないように）
beforeAll(async () => {
  await Promise.all([...Object.values(direct), ...Object.values(groups)].map((load) => load()));
}, 60_000);

describe.each(["general", "demo"])("確認の結果が同じ（APP_MODE=%s・未ログイン・別サイト）", (mode) => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", mode);
    vi.stubEnv("SESSION_SECRET", "test-secret-0123456789-abcdefghijklmnop");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL_UNPOOLED", "");
    vi.stubEnv("DEMO_NOW", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(CASES)("%s %s %j", async (method, path, headers = {}) => {
    const mk = (url: string) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : "{}" });
    const fn = functionFor(path)!;
    const want = await call(await direct[path](), method, mk(path));
    const viaDev = await call(await groups[fn](), method, mk(path)); // 開発サーバー：元の URL のまま届く
    const viaVercel = await call(await groups[fn](), method, mk(`/api/${fn}?__path=${path}`)); // Vercel：rewrite で __path に入って届く
    const body = async (r: Response) => ({ status: r.status, body: await r.text(), cookie: r.headers.get("set-cookie") });
    const expected = await body(want);
    expect(await body(viaDev)).toEqual(expected);
    expect(await body(viaVercel)).toEqual(expected);
    expect([200, 401, 403, 404]).toContain(expected.status); // DB に届く前に、それぞれの確認で止まる（500 で「同じ」にならない）
    if (process.env.SHOW_STATUS) console.log(mode, method, path, expected.status);
  });
});
