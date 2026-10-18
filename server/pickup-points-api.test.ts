import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 受け渡し可能地点・おすすめの受け取り方の API：DB に届く前の確認（モード・ログイン・別サイト）。
// 登録そのもの（地点・毎週の受渡枠・参加・回の作成）は dev の DB を使った E2E で確かめる。
const pickup = await import("./routes/pickup-points");
const options = await import("./routes/plan-options");
const req = (path: string, method = "GET", headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : "{}" });

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789-abcdefghijklmnop");
  vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("DATABASE_URL_UNPOOLED", ""); vi.stubEnv("DEMO_NOW", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("受け渡し可能地点 /api/pickup-points", () => {
  it("デモ用の環境では使えない（404）", async () => {
    vi.stubEnv("APP_MODE", "demo"); vi.stubEnv("DEMO_NOW", "2026-10-22T12:00:00+09:00");
    expect((await pickup.GET(req("/api/pickup-points"))).status).toBe(404);
    expect((await pickup.POST(req("/api/pickup-points", "POST"))).status).toBe(404);
  });
  it("一般向け：未ログインは 401、別サイトからの登録は 403", async () => {
    vi.stubEnv("APP_MODE", "general");
    expect((await pickup.GET(req("/api/pickup-points"))).status).toBe(401);
    expect((await pickup.POST(req("/api/pickup-points", "POST"))).status).toBe(401);
    expect((await pickup.POST(req("/api/pickup-points", "POST", { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("おすすめの受け取り方 /api/plan-options", () => {
  it.each(["general", "demo"])("%s：未ログインは 401、別サイトからは 403", async (mode) => {
    vi.stubEnv("APP_MODE", mode);
    if (mode === "demo") vi.stubEnv("DEMO_NOW", "2026-10-22T12:00:00+09:00");
    expect((await options.POST(req("/api/plan-options", "POST"))).status).toBe(401);
    expect((await options.POST(req("/api/plan-options", "POST", { origin: "https://evil.example" }))).status).toBe(403);
  });
});
