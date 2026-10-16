import { describe, expect, it } from "vitest";
import { isDemoClock, serverNow } from "./clock";

describe("サーバーの現在時刻", () => {
  it("DEMO_NOW があればその時刻を使う", () => {
    expect(serverNow({ DEMO_NOW: "2026-10-22T12:00:00+09:00" }).toISOString()).toBe("2026-10-22T03:00:00.000Z");
    expect(isDemoClock({ DEMO_NOW: "2026-10-22T12:00:00+09:00" })).toBe(true);
  });

  it("DEMO_NOW が無ければ実時刻を使う", () => {
    const before = Date.now();
    const t = serverNow({}).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(isDemoClock({})).toBe(false);
  });

  it("DEMO_NOW の形式が不正なら黙って実時刻にせず止める", () => {
    expect(() => serverNow({ DEMO_NOW: "あした" })).toThrow();
  });
});
