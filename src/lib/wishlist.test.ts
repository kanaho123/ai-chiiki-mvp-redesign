import { describe, expect, it } from "vitest";
import { parseWishList, WISH_MAX, wishKgError } from "./wishlist.js";

describe("欲しい食材の一覧：保存データの読み直し（形式が違う・壊れていても画面を壊さない）", () => {
  it("今の形式（v1）はそのまま読める", () => {
    const raw = { v: 1, rows: [{ id: "a", name: "トマト", kg: "10" }, { id: "b", name: "きゅうり", kg: "5" }], active: "b" };
    expect(parseWishList(raw)).toEqual({ rows: raw.rows, active: "b" });
  });
  it("形式が違う・版が違う・壊れているものは使わない（null：新しく始める）", () => {
    for (const bad of [null, "x", 3, [], {}, { v: 2, rows: [] }, { v: 1 }, { v: 1, rows: "x" }]) expect(parseWishList(bad)).toBeNull();
  });
  it("おかしな行だけを捨てる。数値の量は文字に、長すぎる名前は切る、id の重複は振り直す、行数は上限まで", () => {
    const out = parseWishList({ v: 1, rows: [null, 5, { name: 3 }, { id: "a", name: "トマト", kg: 10 }, { id: "a", name: "あ".repeat(50), kg: { x: 1 } }], active: "zzz" })!;
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toEqual({ id: "a", name: "トマト", kg: "10" });
    expect(out.rows[1].id).not.toBe("a");
    expect(out.rows[1].name).toHaveLength(20);
    expect(out.rows[1].kg).toBe("");
    expect(out.active).toBeNull(); // ない行は表示中にしない
    expect(parseWishList({ v: 1, rows: [null, 3] })!.rows).toMatchObject([{ name: "", kg: "" }]); // 使える行がなければ空の1行
    const many = parseWishList({ v: 1, rows: Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: "トマト", kg: "1" })) })!;
    expect(many.rows).toHaveLength(WISH_MAX);
  });
  it("必要量：空はあとで決める。入っていれば仕入れ案と同じ 1〜100kg の整数", () => {
    for (const ok of ["", " ", "1", "10", "100"]) expect(wishKgError(ok)).toBeNull();
    for (const bad of ["0", "101", "2.5", "-1", "abc"]) expect(wishKgError(bad)).toBe("必要量は1〜100kgの整数で入力してください");
  });
});
