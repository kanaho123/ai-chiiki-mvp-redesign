import { describe, expect, it } from "vitest";
import { GENERAL_SERIES } from "./general-master";
import { addJstDays, jstDateOf, jstWallTime, upcomingOccurrences } from "./service-time";

describe("サービス時刻（Asia/Tokyo）", () => {
  it("UTC では前日でも、日本時間の日付・曜日で扱う", () => {
    // 2026-10-19 23:30Z = 2026-10-20(火) 08:30 JST
    expect(jstDateOf(new Date("2026-10-19T23:30:00Z"))).toEqual({ y: 2026, m: 10, d: 20, weekday: 2 });
  });
  it("日本時間の壁時計を UTC の瞬間にする", () => {
    expect(jstWallTime({ y: 2026, m: 10, d: 20 }, "10:00").toISOString()).toBe("2026-10-20T01:00:00.000Z");
    expect(jstWallTime({ y: 2026, m: 1, d: 1 }, "00:00").toISOString()).toBe("2025-12-31T15:00:00.000Z");
    expect(() => jstWallTime({ y: 2026, m: 10, d: 20 }, "24:00")).toThrow();
    expect(() => jstWallTime({ y: 2026, m: 10, d: 20 }, "9:00")).toThrow();
  });
  it("月末・年末をまたいで日を足せる", () => {
    expect(addJstDays({ y: 2026, m: 12, d: 30 }, 3)).toEqual({ y: 2027, m: 1, d: 2, weekday: 6 });
  });
});

describe("定期枠から実際の回を作る", () => {
  const tueAm = { weekday: 2, startTime: "10:00", endTime: "11:00", deadlineHours: 17 };
  it("28日分で毎週の回を作り、確認締切は前日17時", () => {
    const now = new Date("2026-10-18T03:00:00Z"); // 10/18(日) 12:00 JST
    const list = upcomingOccurrences(tueAm, now, 28);
    expect(list.map((o) => o.startAt.toISOString())).toEqual([
      "2026-10-20T01:00:00.000Z", "2026-10-27T01:00:00.000Z", "2026-11-03T01:00:00.000Z", "2026-11-10T01:00:00.000Z",
    ]);
    expect(list[0].endAt.toISOString()).toBe("2026-10-20T02:00:00.000Z");
    expect(list[0].confirmDeadlineAt.toISOString()).toBe("2026-10-19T08:00:00.000Z"); // 10/19 17:00 JST
  });
  it("確認締切を過ぎた回は作らない", () => {
    const now = new Date("2026-10-19T09:00:00Z"); // 10/19(月) 18:00 JST（翌日火曜の締切後）
    const list = upcomingOccurrences(tueAm, now, 28);
    expect(list[0].startAt.toISOString()).toBe("2026-10-27T01:00:00.000Z");
  });
  it("終了が開始より前の定期枠は止める", () => {
    expect(() => upcomingOccurrences({ ...tueAm, endTime: "09:00" }, new Date("2026-10-18T03:00:00Z"), 28)).toThrow();
  });
  it("運営データの定期枠は、確認締切が開始前日の17時になっている", () => {
    for (const s of GENERAL_SERIES) {
      const [o] = upcomingOccurrences(s, new Date("2026-10-18T03:00:00Z"), 28);
      const d = new Date(o.confirmDeadlineAt.getTime() + 9 * 3600_000);
      expect(d.getUTCHours(), s.id).toBe(17);
      const { weekday, ...startDay } = jstDateOf(o.startAt);
      expect(jstDateOf(o.confirmDeadlineAt), s.id).toEqual(addJstDays(startDay, -1));
    }
  });
});
