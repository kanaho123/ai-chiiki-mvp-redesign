import { findItemByName, itemKey } from "../src/lib/items.js";
import { openAiConfig, SUGGEST_MAX, suggestItemsWithOpenAi, type OpenAiConfig } from "./ai/openai.js";
import { prisma } from "./db.js";

// 飲食店が書いた品目名が登録されていないとき、いま出品されている品目の中から近いものを最大3件出す（一般向けの環境だけ）。
// ・登録済みの品目との照合は通常の処理（findItemByName）。一致すれば AI は呼ばない
// ・AI に渡すのは、いま出品されている品目の一覧だけ。返せるのはその id だけで、ここでも一覧にない id・重複を捨てる
// ・2段階で探す：受け取り日・受け取りの回が決まっていれば、まずその条件で出品がある品目から（仕入れ案の「おまかせ」と同じ読み取りの条件）。
//   そこで近いものがなければ、条件を外して、いま出品中の全品目（1段目で近くないと判断した品目を除く）からもう一度探す（widened）。
//   その日に実際に仕入れられるかは、候補を選んだあとに今までどおり /api/plan-options・/api/plan で判定する
// ・DB には書き込まない（品目も作らない）。AI が使えない・失敗したときは候補なし

export type ItemRef = { id: string; name: string };
export type SuggestCondition = { desiredDate: string | null; slotId: string | null };
/** widened：受け取り日・回の条件を外して見つけた候補（画面で「受け取り可否は選択後に確認します」と添える） */
export type SuggestResult = { match: ItemRef | null; suggestions: ItemRef[]; ai: "skipped" | "ok" | "unavailable" | "failed"; widened: boolean };

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
  if (match) return { match: { id: match.id, name: match.name }, suggestions: [], ai: "skipped", widened: false };
  const none = (ai: SuggestResult["ai"]): SuggestResult => ({ match: null, suggestions: [], ai, widened: false });
  const cfg = deps.cfg === undefined ? openAiConfig() : deps.cfg;

  // 候補一覧から AI に選ばせる（結果は名前と候補一覧ごとに使い回す）。連打防止は1回の問い合わせにつき1回だけ数える
  let gated = false;
  const ask = async (listed: ItemRef[], ai: OpenAiConfig): Promise<ItemRef[] | null | "rate_limited"> => {
    const key = `${itemKey(name)}|${listed.map((i) => i.id).join(",")}`;
    const hit = cache.get(key);
    if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.ids.map((id) => listed.find((i) => i.id === id)!).filter(Boolean);
    if (!gated) {
      if (deps.allowAi && !deps.allowAi()) return "rate_limited";
      gated = true;
    }
    let picked: ItemRef[] | null;
    try {
      picked = pickSuggestions(await (deps.ai ?? suggestItemsWithOpenAi)(name, listed, ai), listed);
    } catch {
      picked = null;
    }
    if (!picked) return null;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now.getTime(), ids: picked.map((i) => i.id) });
    return picked;
  };

  // 1段目：受け取り日・回の条件に合う出品中の品目から
  const narrowed = !!(cond.desiredDate || cond.slotId);
  let judged: ItemRef[] = [];
  if (narrowed) {
    const listed = await listedItems(cond, now);
    if (listed.length > 0) {
      if (!cfg) return none("unavailable");
      const r = await ask(listed, cfg);
      if (r === "rate_limited") return r;
      if (r === null) return none("failed"); // 失敗したら2段目は呼ばない
      if (r.length > 0) return { match: null, suggestions: r, ai: "ok", widened: false };
      judged = listed;
    }
  }
  // 2段目（条件がなければこれだけ）：いま出品中の全品目から。1段目で近くないと判断した品目は除く
  const listed = (await listedItems({ desiredDate: null, slotId: null }, now)).filter((i) => !judged.some((j) => j.id === i.id));
  if (listed.length === 0) return none(judged.length ? "ok" : "skipped");
  if (!cfg) return none("unavailable");
  const r = await ask(listed, cfg);
  if (r === "rate_limited") return r;
  if (r === null) return none("failed");
  return { match: null, suggestions: r, ai: "ok", widened: narrowed && r.length > 0 };
}

/** テスト用 */
export const clearSuggestCache = () => cache.clear();
