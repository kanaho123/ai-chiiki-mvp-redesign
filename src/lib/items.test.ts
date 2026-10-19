import { describe, expect, it } from "vitest";
import { findItemByName, ITEM_NAME_MAX, itemKey, parseItemName } from "./items.js";
import { parseSupplyInput } from "./validate.js";

describe("品目名の入力（生産者の出品）", () => {
  it("固定の候補にない地域の食材もそのまま使える（前後の空白は除き、続く空白は1つ）", () => {
    for (const n of ["万願寺とうがらし", "水なす", "九条ねぎ", "ミニトマト", "Kale"]) expect(parseItemName(n)).toMatchObject({ ok: true, name: n });
    expect(parseItemName("賀茂なす（大）")).toMatchObject({ ok: true, name: "賀茂なす(大)" }); // 全角の括弧は半角にそろえる（NFKC）
    expect(parseItemName("  万願寺  とうがらし ")).toMatchObject({ ok: true, name: "万願寺 とうがらし" });
    expect(parseItemName("ﾄﾏﾄ")).toMatchObject({ ok: true, name: "トマト" }); // 半角カナは全角にそろえる
  });
  it("空・長すぎる・記号・数字だけは受け付けない（理由を返す）", () => {
    expect(parseItemName("")).toMatchObject({ ok: false, error: "品目を入力してください" });
    expect(parseItemName("   ")).toMatchObject({ ok: false });
    expect(parseItemName(undefined)).toMatchObject({ ok: false });
    expect(parseItemName("あ".repeat(ITEM_NAME_MAX))).toMatchObject({ ok: true });
    expect(parseItemName("あ".repeat(ITEM_NAME_MAX + 1))).toMatchObject({ ok: false, error: `品目は${ITEM_NAME_MAX}文字以内で入力してください` });
    for (const bad of ["<script>", "トマト;", "なす/きゅうり", "トマト!", "https://x"]) expect(parseItemName(bad)).toMatchObject({ ok: false });
    expect(parseItemName("123")).toMatchObject({ ok: false, error: "品目の名前を入力してください" });
  });
  it("照合の鍵：カタカナ・ひらがな・全角・半角・空白の違いは同じ品目", () => {
    expect(itemKey("ナス")).toBe(itemKey("なす"));
    expect(itemKey("ﾅｽ")).toBe(itemKey("なす"));
    expect(itemKey(" な す ")).toBe(itemKey("なす"));
    expect(itemKey("水なす")).not.toBe(itemKey("なす"));
    const items = [{ id: "i-n", name: "なす" }, { id: "i-t", name: "トマト" }];
    expect(findItemByName("ナス", items)?.id).toBe("i-n");
    expect(findItemByName("とまと", items)?.id).toBe("i-t");
    expect(findItemByName("万願寺とうがらし", items)).toBeNull();
  });
});

describe("出品の入力：既存の品目（itemId）か、品目名（itemName）", () => {
  const base = { grade: "regular", originPrefecture: "大阪府", availableKg: 3, priceYenPerKg: 800, minKg: 1, slotId: "s", published: true };
  it("既存の品目は今までどおり（品目と品種）", () => {
    expect(parseSupplyInput({ ...base, itemId: "i", varietyId: "v" })).toMatchObject({ ok: true, value: { itemId: "i", varietyId: "v", itemName: null } });
    expect(parseSupplyInput({ ...base, itemId: "i" })).toMatchObject({ ok: false, error: "品種を選択してください" });
  });
  it("品目名だけでも受け付ける（品種はサーバーで「指定なし」を使う）。名前の形が違えば理由を返す", () => {
    expect(parseSupplyInput({ ...base, itemName: " 万願寺とうがらし " })).toMatchObject({ ok: true, value: { itemId: null, varietyId: null, itemName: "万願寺とうがらし" } });
    expect(parseSupplyInput({ ...base, itemName: "" })).toMatchObject({ ok: false, error: "品目を入力してください" });
    expect(parseSupplyInput({ ...base })).toMatchObject({ ok: false, error: "品目を入力してください" });
    expect(parseSupplyInput({ ...base, itemName: "<b>" })).toMatchObject({ ok: false });
  });
});
