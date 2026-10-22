import { describe, expect, it } from "vitest";
import {
  handoverChoices, handoverWindow, kindOrOther, parseExistingPlace, parseHandover, parsePickupPoint, periodLabel, placeKindLabel, PRODUCER_KIND_CHOICES, seriesSub, weeklyText,
} from "./pickup";

const ok = { name: " 〇〇直売所 ", address: "大阪府堺市南区1-2-3", kind: "direct_store", note: "" };

describe("受け渡し可能地点の入力（場所だけ。曜日・時間は聞かない）", () => {
  it("地点名・住所・種類がそろえば登録できる（前後の空白は除き、補足は空なら null）。曜日・時間は送られても使わない", () => {
    expect(parsePickupPoint(ok)).toEqual({ ok: true, value: { name: "〇〇直売所", address: "大阪府堺市南区1-2-3", kind: "direct_store", note: null } });
    expect(parsePickupPoint({ ...ok, weekday: 5, startTime: "16:00", endTime: "18:00" })).toEqual({ ok: true, value: { name: "〇〇直売所", address: "大阪府堺市南区1-2-3", kind: "direct_store", note: null } });
    expect(parsePickupPoint({ ...ok, kind: "other", name: "〇〇公民館", note: "裏口でお渡し" })).toMatchObject({ ok: true, value: { kind: "other", name: "〇〇公民館", note: "裏口でお渡し" } });
  });
  it("足りない・おかしい項目は、その項目の理由を返す", () => {
    expect(parsePickupPoint({ ...ok, name: "  " })).toMatchObject({ ok: false, field: "name" });
    expect(parsePickupPoint({ ...ok, name: "あ".repeat(41) })).toMatchObject({ ok: false, field: "name" });
    expect(parsePickupPoint({ ...ok, address: "" })).toMatchObject({ ok: false, field: "address" });
    expect(parsePickupPoint({ ...ok, kind: "warehouse" })).toMatchObject({ ok: false, field: "kind" });
    expect(parsePickupPoint({ ...ok, note: "あ".repeat(101) })).toMatchObject({ ok: false, field: "note" });
    expect(parsePickupPoint(null)).toMatchObject({ ok: false, field: "name" });
  });
  it("表示の言葉：種類（「その他」は画面に出さない）・以前の毎週の時間帯・参加する受渡枠の説明", () => {
    expect(placeKindLabel("collection_point")).toBe("集荷場");
    expect(placeKindLabel("other")).toBeNull(); // 「その他」は分類だけ。画面には場所の名前を出す
    expect(placeKindLabel(null)).toBeNull();
    expect(weeklyText({ weekday: 5, startTime: "16:00", endTime: "18:00" })).toBe("毎週金曜 16:00〜18:00");
    expect(seriesSub({ weekday: 5, startTime: "16:00", endTime: "18:00", feeYen: 0, placeKind: "direct_store" }, "毎週金曜日 16:00〜18:00")).toBe("直売所・毎週金曜日 16:00〜18:00・受け渡し費用なし");
    expect(seriesSub({ weekday: 2, startTime: "10:00", endTime: "11:00", feeYen: 800, placeKind: null }, "毎週火曜日 10:00〜11:00")).toBe("毎週火曜日 10:00〜11:00・受渡料金 800円");
  });
});

describe("すでにある場所で「ここで渡せる」", () => {
  it("場所だけで通る（曜日・時間などほかの項目は使わない）", () => {
    expect(parseExistingPlace({ placeId: "pl_1", weekday: 5, startTime: "16:00", name: "無視" })).toEqual({ ok: true, value: { placeId: "pl_1" } });
  });
  it("場所がない・おかしいときは、やさしい言葉で理由を返す", () => {
    expect(parseExistingPlace({})).toMatchObject({ ok: false, field: "placeId", error: "場所を選んでください" });
    expect(parseExistingPlace({ placeId: "a b" })).toMatchObject({ ok: false, field: "placeId" });
  });
  it("生産者に見せる場所の種類は「いつもの〜」の言葉。種類のない場所（はじめからある場所）は「その他」", () => {
    expect(PRODUCER_KIND_CHOICES.map((c) => c.label)).toEqual(["いつもの直売所", "いつもの集荷場所", "いつもの出荷先", "自分の農園", "その他"]);
    expect(kindOrOther(null)).toBe("other");
    expect(kindOrOther("direct_store")).toBe("direct_store");
  });
});

describe("出品のときの受け渡し（いつもの場所・渡せる日・時間帯）", () => {
  // 2026-10-22（木）12:00（日本時間）
  const now = new Date("2026-10-22T03:00:00.000Z");
  it("時間帯は午前 9:00〜12:00／午後 13:00〜17:00。確認の締切は受け渡し開始の17時間前", () => {
    expect(periodLabel("am")).toBe("午前（9:00〜12:00）");
    expect(periodLabel("pm")).toBe("午後（13:00〜17:00）");
    expect(handoverWindow("2026-10-24", "am")).toEqual({
      startAt: new Date("2026-10-24T00:00:00.000Z"), endAt: new Date("2026-10-24T03:00:00.000Z"), confirmDeadlineAt: new Date("2026-10-23T07:00:00.000Z"),
    });
  });
  it("選べる日は今日から14日先まで。締切が過ぎた日・時間帯は出さない（今日は選べず、明日は午前・午後とも締切前）", () => {
    const c = handoverChoices(now);
    expect(c[0]).toEqual({ date: "2026-10-23", periods: ["am", "pm"] }); // 明日の午前の締切は今日 16:00
    expect(c.some((x) => x.date === "2026-10-22")).toBe(false);
    expect(c.at(-1)!.date).toBe("2026-11-05");
    // 今日 18:00 なら、明日の午前（締切 16:00）は選べず、午後（締切 20:00）は選べる
    expect(handoverChoices(new Date("2026-10-22T09:00:00.000Z"))[0]).toEqual({ date: "2026-10-23", periods: ["pm"] });
  });
  it("場所・日・時間帯がそろい、選べる日時なら通る。足りない・選べないときは理由を返す", () => {
    expect(parseHandover({ placeId: "pl_1", date: "2026-10-24", period: "pm" }, now)).toEqual({ ok: true, value: { placeId: "pl_1", date: "2026-10-24", period: "pm" } });
    expect(parseHandover({ date: "2026-10-24", period: "pm" }, now)).toMatchObject({ ok: false, error: "受け渡しの場所を選んでください" });
    expect(parseHandover({ placeId: "pl_1", period: "pm" }, now)).toMatchObject({ ok: false, error: "渡せる日を選んでください" });
    expect(parseHandover({ placeId: "pl_1", date: "2026-10-24", period: "night" }, now)).toMatchObject({ ok: false, error: "渡せる時間帯を選んでください" });
    expect(parseHandover({ placeId: "pl_1", date: "2026-10-22", period: "pm" }, now)).toMatchObject({ ok: false, error: "その日・時間帯は選べません。選び直してください" });
    expect(parseHandover({ placeId: "pl_1", date: "2026-12-01", period: "am" }, now)).toMatchObject({ ok: false });
  });
});
