import { useEffect, useId, useState } from "react";

// 飲食店が書いた品目名が登録されていないとき：近い食材の候補（いま出品されている品目から最大3件）を出す。一般向けの環境だけで使う。
// 候補は押したときだけ使う（書いた名前を勝手に置き換えない）。候補がない・取れないときは「いま、この品目の出品はありません」だけ。
// 希望の受け取り日・回では出品がない候補（conditionAvailable=false）にだけ「受け取り可否は選択後に確認します」を添える。

export const NO_LISTING = "いま、この品目の出品はありません";
export const SUGGEST_DELAY_MS = 700; // 入力が止まってから探す（キー入力のたびには呼ばない）

export type ItemRef = { id: string; name: string };
type Suggestion = ItemRef & { conditionAvailable: boolean };
type Cond = { desiredDate: string | null; slotId: string | null };
type Found = { list: Suggestion[] };

// 同じ名前・条件の結果は、画面を開いている間は使い回す（候補を取れなかったときは覚えない）
const cache = new Map<string, Found>();

async function fetchSuggestions(name: string, cond: Cond, signal: AbortSignal): Promise<Found & { keep: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("/api/item-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, ...cond }), signal });
    if (r.status === 429 && attempt === 0) {
      await new Promise((ok) => setTimeout(ok, 1200));
      continue;
    }
    if (!r.ok) return { list: [], keep: false };
    const d = await r.json().catch(() => null);
    const list: Suggestion[] = Array.isArray(d?.suggestions)
      ? (d.suggestions as unknown[])
        .filter((x): x is ItemRef => !!x && typeof (x as ItemRef).id === "string" && typeof (x as ItemRef).name === "string")
        .slice(0, 3)
        .map((x) => ({ id: x.id, name: x.name, conditionAvailable: (x as Partial<Suggestion>).conditionAvailable !== false }))
      : [];
    return { list, keep: d?.ai === "ok" || d?.ai === "skipped" };
  }
  return { list: [], keep: false };
}

export function NoListing({ name, desiredDate, slotId, onPick }: { name: string; desiredDate: string | null; slotId: string | null; onPick: (item: ItemRef) => void }) {
  const trimmed = name.trim();
  const key = `${trimmed}|${desiredDate ?? ""}|${slotId ?? ""}`;
  const titleId = useId();
  const [state, setState] = useState<{ key: string; found: Found | null }>(() => ({ key, found: cache.get(key) ?? null }));

  useEffect(() => {
    const cached = cache.get(key);
    if (cached) return setState({ key, found: cached });
    setState({ key, found: null });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchSuggestions(trimmed, { desiredDate, slotId }, controller.signal)
        .then(({ keep, ...found }) => {
          if (keep) cache.set(key, found);
          setState({ key, found });
        })
        .catch(() => { if (!controller.signal.aborted) setState({ key, found: { list: [] } }); });
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]); // trimmed・desiredDate・slotId は key に含まれる

  const found = state.key === key ? state.found : null;
  if (found === null) return <p className="wish-note" role="status">近い食材を探しています…</p>;
  const { list } = found;
  if (list.length === 0) return <p className="wish-note no-listing" role="status">{NO_LISTING}</p>;
  return (
    <div className="item-alts">
      <p className="wish-note no-listing" role="status">{trimmed}は現在ありません</p>
      <p className="item-alts-title" id={titleId}>近い食材</p>
      <div className="item-alts-chips" role="group" aria-labelledby={titleId}>
        {list.map((i) => (
          <button key={i.id} type="button" className={`wish-chip item-alt${i.conditionAvailable ? "" : " off-condition"}`} onClick={() => onPick({ id: i.id, name: i.name })}>
            <span>{i.name}</span>
            {!i.conditionAvailable && <small className="item-alts-note">受け取り可否は選択後に確認します</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** テスト用 */
export const clearSuggestionCache = () => cache.clear();
