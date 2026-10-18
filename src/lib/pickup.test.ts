import { describe, expect, it } from "vitest";
import { parsePickupPoint, placeKindLabel, seriesSub, weeklyText } from "./pickup";

const ok = { name: " 〇〇直売所 ", address: "大阪府堺市南区1-2-3", kind: "direct_store", weekday: "5", startTime: "16:00", endTime: "18:00", note: "" };

describe("受け渡し可能地点の入力", () => {
  it("地点名・住所・種類・曜日・時間帯がそろえば登録できる（前後の空白は除き、補足は空なら null）", () => {
    expect(parsePickupPoint(ok)).toEqual({ ok: true, value: { name: "〇〇直売所", address: "大阪府堺市南区1-2-3", kind: "direct_store", weekday: 5, startTime: "16:00", endTime: "18:00", note: null } });
    expect(parsePickupPoint({ ...ok, weekday: 0, note: "裏口でお渡し" })).toMatchObject({ ok: true, value: { weekday: 0, note: "裏口でお渡し" } });
  });
  it("足りない・おかしい項目は、その項目の理由を返す", () => {
    expect(parsePickupPoint({ ...ok, name: "  " })).toMatchObject({ ok: false, field: "name" });
    expect(parsePickupPoint({ ...ok, name: "あ".repeat(41) })).toMatchObject({ ok: false, field: "name" });
    expect(parsePickupPoint({ ...ok, address: "" })).toMatchObject({ ok: false, field: "address" });
    expect(parsePickupPoint({ ...ok, kind: "warehouse" })).toMatchObject({ ok: false, field: "kind" });
    expect(parsePickupPoint({ ...ok, weekday: "7" })).toMatchObject({ ok: false, field: "weekday" });
    expect(parsePickupPoint({ ...ok, weekday: "" })).toMatchObject({ ok: false, field: "weekday" });
    expect(parsePickupPoint({ ...ok, startTime: "25:00" })).toMatchObject({ ok: false, field: "startTime" });
    expect(parsePickupPoint({ ...ok, endTime: "16:00" })).toMatchObject({ ok: false, field: "endTime", error: "終了の時刻は開始より後にしてください" });
    expect(parsePickupPoint({ ...ok, note: "あ".repeat(101) })).toMatchObject({ ok: false, field: "note" });
    expect(parsePickupPoint(null)).toMatchObject({ ok: false, field: "name" });
  });
  it("表示の言葉：種類・毎週の時間帯・参加する受渡枠の説明（生産者の地点は受け渡し費用なし）", () => {
    expect(placeKindLabel("collection_point")).toBe("集荷場");
    expect(placeKindLabel(null)).toBeNull();
    expect(weeklyText({ weekday: 5, startTime: "16:00", endTime: "18:00" })).toBe("毎週金曜 16:00〜18:00");
    expect(seriesSub({ weekday: 5, startTime: "16:00", endTime: "18:00", feeYen: 0, placeKind: "direct_store" }, "毎週金曜日 16:00〜18:00")).toBe("直売所・毎週金曜日 16:00〜18:00・受け渡し費用なし");
    expect(seriesSub({ weekday: 2, startTime: "10:00", endTime: "11:00", feeYen: 800, placeKind: null }, "毎週火曜日 10:00〜11:00")).toBe("毎週火曜日 10:00〜11:00・受渡料金 800円");
  });
});
