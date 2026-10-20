import { ITEM_NAME_MAX, itemKey } from "./items.js";
import { QUANTITY_KG_MAX, QUANTITY_KG_MIN } from "./allocate.js";

// 飲食店の「欲しい食材」の一覧（品目＋必要量）。DB には保存せず、ブラウザ（localStorage）に店ごとに保持する。
// 仕入れ案は1品目ずつ、今までどおりの流れ（条件の確認 → /api/plan）で計算する。品目をまとめて計算することはしない。
// 保存の形式：{ v: 1, rows: Wish[], active: string | null }。形式が違う・壊れているときは使わない（画面は壊さない）。

export type Wish = { id: string; name: string; kg: string };
export type WishList = { rows: Wish[]; active: string | null };

export const WISH_MAX = 10;
const VERSION = 1;
export const wishStorageKey = (userId: string) => `ai-chiiki:restaurant:wishes:v${VERSION}:${userId}`;

let seq = 0;
export const newWish = (name = "", kg = ""): Wish => ({ id: `w${Date.now().toString(36)}${(seq++).toString(36)}`, name, kg });

/** 保存されていた値を読み直す。形式が違えば null（新しく始める）。行は1つずつ確かめ、おかしな行だけ捨てる */
export function parseWishList(raw: unknown): WishList | null {
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== VERSION) return null;
  const rows = (raw as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const out: Wish[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const { id, name, kg } = r as Record<string, unknown>;
    if (typeof name !== "string") continue;
    const kgText = typeof kg === "number" && Number.isFinite(kg) ? String(kg) : typeof kg === "string" ? kg.slice(0, 6) : "";
    out.push({ id: typeof id === "string" && id && !out.some((w) => w.id === id) ? id : newWish().id, name: name.slice(0, ITEM_NAME_MAX), kg: kgText });
    if (out.length >= WISH_MAX) break;
  }
  if (out.length === 0) out.push(newWish()); // 行がなくなったら空の1行から
  const active = (raw as { active?: unknown }).active;
  return { rows: out, active: typeof active === "string" && out.some((w) => w.id === active) ? active : null };
}

export function loadWishList(userId: string): WishList | null {
  try {
    const raw = localStorage.getItem(wishStorageKey(userId));
    return raw ? parseWishList(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveWishList(userId: string, list: WishList) {
  try {
    localStorage.setItem(wishStorageKey(userId), JSON.stringify({ v: VERSION, ...list }));
  } catch {}
}

/** 必要量の入力：空は「あとで決める」。入っていれば仕入れ案と同じ範囲の整数か */
export function wishKgError(kg: string): string | null {
  if (!kg.trim()) return null;
  const n = Number(kg);
  return Number.isInteger(n) && n >= QUANTITY_KG_MIN && n <= QUANTITY_KG_MAX ? null : `必要量は${QUANTITY_KG_MIN}〜${QUANTITY_KG_MAX}kgの整数で入力してください`;
}

/**
 * 確認の画面で「いま確認する食材」（1行目）を決める。AI が読み取った食材・入力中の食材（name・kg）を1行目にして active にする。
 * 同じ品目（照合の鍵が同じ）の行があればそれを使い、空の行があればそれに入れ、なければ先頭に足す（上限なら先頭を置き換える）。
 */
export function activateFirst(list: WishList | null, name: string, kg: string): WishList {
  const rows = list?.rows ?? [];
  const key = name.trim() ? itemKey(name) : null;
  const same = key ? rows.find((w) => w.name.trim() && itemKey(w.name) === key) : undefined;
  const empty = rows.find((w) => !w.name.trim() && !w.kg.trim());
  const target = same ?? empty;
  if (target) {
    const updated = { ...target, name: name.trim() ? name : target.name, kg: kg || target.kg };
    return { rows: [updated, ...rows.filter((w) => w.id !== target.id)], active: updated.id };
  }
  const fresh = newWish(name, kg);
  const rest = rows.length >= WISH_MAX ? rows.slice(1) : rows;
  return { rows: [fresh, ...rest], active: fresh.id };
}
