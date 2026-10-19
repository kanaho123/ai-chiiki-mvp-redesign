import { kanaFold, normalize } from "./resolve.js";

// 品目名の入力と照合（画面とサーバーで共通）。
// 照合の鍵は AI 読み取りの照合（resolve.ts）と同じ規則：全角・半角をそろえ、空白を除き、カタカナをひらがなにする
// （「ナス」「なす」「ナス 」は同じ品目）。
// MVP の判断として、この鍵はアプリ側で照合するだけで、DB の一意制約にはしていない（同時に登録されると表記違いが重複しうる）。
// 将来は Item に正規化した鍵の列を足し、DB で一意にする方が安全。

export const ITEM_NAME_MAX = 20;

/** 照合の鍵（同じ品目かどうかの判定に使う） */
export const itemKey = (name: string) => kanaFold(normalize(name));

export type ItemNameResult = { ok: true; name: string; key: string } | { ok: false; error: string };

/**
 * 生産者が入力した品目名を確かめ、保存用の表示名と照合の鍵を返す。
 * 使える文字：かな・カナ・漢字・英字・数字・長音（ー）・中黒（・）・々・〆・ヶ・括弧・空白（前後の空白は除き、続く空白は1つにする）
 */
export function parseItemName(raw: unknown): ItemNameResult {
  if (typeof raw !== "string") return { ok: false, error: "品目を入力してください" };
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "品目を入力してください" };
  if ([...name].length > ITEM_NAME_MAX) return { ok: false, error: `品目は${ITEM_NAME_MAX}文字以内で入力してください` };
  if (!/^[\p{L}\p{N}ー・々〆ヶ()（） ]+$/u.test(name)) return { ok: false, error: "品目には文字と数字だけを使ってください（記号は使えません）" };
  if (!/\p{L}/u.test(name)) return { ok: false, error: "品目の名前を入力してください" };
  return { ok: true, name, key: itemKey(name) };
}

/** すでにある品目から、同じ鍵のものを探す（なければ null） */
export function findItemByName<T extends { name: string }>(name: string, items: T[]): T | null {
  const key = itemKey(name);
  return items.find((i) => itemKey(i.name) === key) ?? null;
}
