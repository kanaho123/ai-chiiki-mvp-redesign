import { describe, expect, it } from "vitest";
import { clientIp, FailureLimiter, IntervalLimiter } from "./rate-limit.js";

describe("回数制限", () => {
  it("失敗が上限に達したらロック期間だけ拒否し、期間が過ぎれば解除する", () => {
    const l = new FailureLimiter(3, 1000, 5000);
    l.fail("k", 0); l.fail("k", 10);
    expect(l.isLocked("k", 20)).toBe(false);
    l.fail("k", 30);
    expect(l.isLocked("k", 40)).toBe(true);
    expect(l.isLocked("k", 5031)).toBe(false);
  });

  it("集計期間を過ぎた失敗は数え直す", () => {
    const l = new FailureLimiter(2, 1000, 5000);
    l.fail("k", 0);
    l.fail("k", 2000);
    expect(l.isLocked("k", 2001)).toBe(false);
  });

  it("最低間隔より短い連続呼び出しは拒否する", () => {
    const l = new IntervalLimiter(3000);
    expect(l.take("u", 0)).toBe(true);
    expect(l.take("u", 2999)).toBe(false);
    expect(l.take("u", 3000)).toBe(true);
    expect(l.take("other", 3001)).toBe(true);
  });

  it("接続元 IP は x-forwarded-for の先頭を使う", () => {
    expect(clientIp(new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" } }))).toBe("203.0.113.1");
    expect(clientIp(new Request("http://x/"))).toBe("unknown");
  });
});
