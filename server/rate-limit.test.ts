import { describe, expect, it } from "vitest";
import { clientIp, IntervalLimiter } from "./rate-limit.js";

describe("回数制限", () => {
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
