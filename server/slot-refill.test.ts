import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 受渡の回の補充を、画面の読み込みのついでに呼ぶ処理のテスト（補充そのものは general-master.test.ts）。
const calls = vi.hoisted(() => ({ n: 0, fail: false }));
vi.mock("./db.js", () => ({ prisma: {} }));
vi.mock("./general-master.js", () => ({
  ensureUpcomingSlots: async () => { calls.n++; if (calls.fail) throw new Error("db down"); return {}; },
}));
const { refillSlotsIfDue, resetSlotRefillTimer } = await import("./slot-refill");

beforeEach(() => { calls.n = 0; calls.fail = false; resetSlotRefillTimer(); vi.stubEnv("APP_MODE", "general"); });
afterEach(() => vi.unstubAllEnvs());

describe("refillSlotsIfDue", () => {
  it("一般向けの環境だけで動く（デモ用の環境では何もしない）", async () => {
    vi.stubEnv("APP_MODE", "demo");
    await refillSlotsIfDue();
    expect(calls.n).toBe(0);
    vi.stubEnv("APP_MODE", "general");
    await refillSlotsIfDue();
    expect(calls.n).toBe(1);
  });
  it("同じインスタンスでは10分に1回まで", async () => {
    await refillSlotsIfDue();
    await refillSlotsIfDue();
    await refillSlotsIfDue();
    expect(calls.n).toBe(1);
  });
  it("失敗しても画面の処理は止めず、次の呼び出しでもう一度試す", async () => {
    calls.fail = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(refillSlotsIfDue()).resolves.toBeUndefined();
    calls.fail = false;
    await refillSlotsIfDue();
    expect(calls.n).toBe(2);
    expect(err.mock.calls[0][0]).toBe("SlotRefillError");
    err.mockRestore();
  });
});
