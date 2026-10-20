import { findItemByName, itemKey } from "../src/lib/items.js";
import { openAiConfig, SUGGEST_MAX, suggestItemsWithOpenAi, type OpenAiConfig } from "./ai/openai.js";
import { prisma } from "./db.js";
import { GENERAL_ITEM_CATEGORIES } from "./general-master.js";

// 飲食店が書いた品目名が登録されていないとき、いま出品されている品目の中から近いものを最大3件出す（一般向けの環境だけ）。
// ・登録済みの品目との照合は通常の処理（findItemByName）。一致すれば AI は呼ばない
// ・AI に渡すのは、いま出品されている品目の一覧だけ。返せるのはその id だけで、ここでも一覧にない id・重複を捨てる
// ・AI は1回の問い合わせにつき1回だけ呼ぶ。いま出品中の具体的な品目をまとめて渡し、受け取り日・回が決まっていれば、
//   各品目にその条件で出品があるか（conditionAvailable。仕入れ案の「おまかせ」と同じ読み取りの条件）を付ける。
//   AI は条件内の品目を優先し、近いものがなければ条件外（別の日なら出品あり）から選ぶ。
//   その日に実際に仕入れられるかは、候補を選んだあとに今までどおり /api/plan-options・/api/plan で判定する
// ・「葉物」「根菜」のような大分類の名前は候補にしない（具体的な食材だけ。マスタの品目自体はそのまま）
// ・DB には書き込まない（品目も作らない）。AI が使えない・失敗したときは候補なし

export type ItemRef = { id: string; name: string };
/** conditionAvailable=false：希望の受け取り日・回では出品がない（別の日なら出品あり）。画面で「受け取り可否は選択後に確認します」と添える */
export type Suggestion = ItemRef & { conditionAvailable: boolean };
export type SuggestCondition = { desiredDate: string | null; slotId: string | null };
export type SuggestResult = { match: ItemRef | null; suggestions: Suggestion[]; ai: "skipped" | "ok" | "unavailable" | "failed" };

export const SUGGEST_CANDIDATES_MAX = 60;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; ids: string[] }>();

const CATEGORY_KEYS = new Set<string>(GENERAL_ITEM_CATEGORIES.map(itemKey));

/** いま出品されている具体的な品目：公開中・販売できる量あり・確認締切前の受け渡しの回（大分類の名前は除く）。受け取り日（日本時間）・回が決まっていればその条件で */
export async function listedItems(cond: SuggestCondition, now: Date): Promise<ItemRef[]> {
  const start = cond.desiredDate ? new Date(`${cond.desiredDate}T00:00:00+09:00`) : null;
  const slot = cond.slotId ? { id: cond.slotId } : start ? { startAt: { gte: start, lt: new Date(start.getTime() + 24 * 3600e3) } } : {};
  const items = await prisma.item.findMany({
    where: { name: { notIn: [...GENERAL_ITEM_CATEGORIES] }, supplies: { some: { published: true, availableKg: { gt: 0 }, slot: { confirmDeadlineAt: { gt: now }, ...slot } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: SUGGEST_CANDIDATES_MAX,
  });
  return items.filter((i) => !CATEGORY_KEYS.has(itemKey(i.name))); // 表記の違い（全角・半角など）も除く
}

/** AI の出力から、候補一覧にある id だけを、重複なく最大3件 */
export function pickSuggestions<T extends ItemRef>(raw: unknown, listed: T[]): T[] | null {
  const ids = (raw as { itemIds?: unknown } | null)?.itemIds;
  if (!Array.isArray(ids)) return null;
  const out: T[] = [];
  for (const id of ids) {
    const hit = listed.find((i) => i.id === id);
    if (hit && !out.includes(hit)) out.push(hit);
    if (out.length >= SUGGEST_MAX) break;
  }
  return out;
}

export async function suggestItems(
  name: string,
  cond: SuggestCondition,
  now: Date,
  deps: { cfg?: OpenAiConfig | null; ai?: typeof suggestItemsWithOpenAi; allowAi?: () => boolean } = {},
): Promise<SuggestResult | "rate_limited"> {
  const all = await prisma.item.findMany({ select: { id: true, name: true } });
  const match = findItemByName(name, all);
  if (match) return { match: { id: match.id, name: match.name }, suggestions: [], ai: "skipped" };
  const none = (ai: SuggestResult["ai"]): SuggestResult => ({ match: null, suggestions: [], ai });

  // いま出品中の具体的な品目。受け取り日・回が決まっていれば、その条件で出品がある品目を先に並べ、ほかは条件外として印を付ける
  const listed = await listedItems({ desiredDate: null, slotId: null }, now);
  const inCond = cond.desiredDate || cond.slotId ? new Set((await listedItems(cond, now)).map((i) => i.id)) : null;
  const candidates: Suggestion[] = listed
    .map((i) => ({ ...i, conditionAvailable: inCond ? inCond.has(i.id) : true }))
    .sort((a, b) => Number(b.conditionAvailable) - Number(a.conditionAvailable));
  if (candidates.length === 0) return none("skipped");
  const cfg = deps.cfg === undefined ? openAiConfig() : deps.cfg;
  if (!cfg) return none("unavailable");

  const key = `${itemKey(name)}|${candidates.map((c) => `${c.id}:${c.conditionAvailable ? 1 : 0}`).join(",")}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) {
    return { match: null, suggestions: hit.ids.map((id) => candidates.find((c) => c.id === id)!).filter(Boolean), ai: "ok" };
  }
  if (deps.allowAi && !deps.allowAi()) return "rate_limited";

  let picked: Suggestion[] | null;
  try {
    picked = pickSuggestions(await (deps.ai ?? suggestItemsWithOpenAi)(name, candidates, cfg), candidates);
  } catch {
    picked = null;
  }
  if (!picked) return none("failed");
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now.getTime(), ids: picked.map((i) => i.id) });
  return { match: null, suggestions: picked, ai: "ok" };
}

/** テスト用 */
export const clearSuggestCache = () => cache.clear();
