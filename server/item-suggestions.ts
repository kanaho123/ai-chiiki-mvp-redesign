import { findItemByName, itemKey } from "../src/lib/items.js";
import { openAiConfig, SUGGEST_MAX, suggestItemsWithOpenAi, type OpenAiConfig } from "./ai/openai.js";
import { prisma } from "./db.js";

// 飲食店が書いた品目名が登録されていないとき、いま出品されている品目の中から近いものを最大3件出す（一般向けの環境だけ）。
// ・登録済みの品目との照合は通常の処理（findItemByName）。一致すれば AI は呼ばない
// ・AI に渡すのは、いま出品されている品目の一覧だけ。返せるのはその id だけで、ここでも一覧にない id・重複を捨てる
// ・受け取り日・受け取りの回が決まっていれば、その条件で出品がある品目だけに絞る（仕入れ案の「おまかせ」と同じ読み取りの条件）
// ・DB には書き込まない（品目も作らない）。AI が使えない・失敗したときは候補なし

export type ItemRef = { id: string; name: string };
export type SuggestCondition = { desiredDate: string | null; slotId: string | null };
export type SuggestResult = { match: ItemRef | null; suggestions: ItemRef[]; ai: "skipped" | "ok" | "unavailable" | "failed" };

export const SUGGEST_CANDIDATES_MAX = 60;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; ids: string[] }>();

/** いま出品されている品目：公開中・販売できる量あり・確認締切前の受け渡しの回。受け取り日（日本時間）・回が決まっていればその条件で */
export async function listedItems(cond: SuggestCondition, now: Date): Promise<ItemRef[]> {
  const start = cond.desiredDate ? new Date(`${cond.desiredDate}T00:00:00+09:00`) : null;
  const slot = cond.slotId ? { id: cond.slotId } : start ? { startAt: { gte: start, lt: new Date(start.getTime() + 24 * 3600e3) } } : {};
  return prisma.item.findMany({
    where: { supplies: { some: { published: true, availableKg: { gt: 0 }, slot: { confirmDeadlineAt: { gt: now }, ...slot } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: SUGGEST_CANDIDATES_MAX,
  });
}

/** AI の出力から、候補一覧にある id だけを、重複なく最大3件 */
export function pickSuggestions(raw: unknown, listed: ItemRef[]): ItemRef[] | null {
  const ids = (raw as { itemIds?: unknown } | null)?.itemIds;
  if (!Array.isArray(ids)) return null;
  const out: ItemRef[] = [];
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

  const listed = await listedItems(cond, now);
  if (listed.length === 0) return { match: null, suggestions: [], ai: "skipped" };
  const cfg = deps.cfg === undefined ? openAiConfig() : deps.cfg;
  if (!cfg) return { match: null, suggestions: [], ai: "unavailable" };

  const key = `${itemKey(name)}|${listed.map((i) => i.id).join(",")}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) {
    return { match: null, suggestions: hit.ids.map((id) => listed.find((i) => i.id === id)!).filter(Boolean), ai: "ok" };
  }
  if (deps.allowAi && !deps.allowAi()) return "rate_limited";

  let picked: ItemRef[] | null;
  try {
    picked = pickSuggestions(await (deps.ai ?? suggestItemsWithOpenAi)(name, listed, cfg), listed);
  } catch {
    picked = null;
  }
  if (!picked) return { match: null, suggestions: [], ai: "failed" };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now.getTime(), ids: picked.map((i) => i.id) });
  return { match: null, suggestions: picked, ai: "ok" };
}

/** テスト用 */
export const clearSuggestCache = () => cache.clear();
