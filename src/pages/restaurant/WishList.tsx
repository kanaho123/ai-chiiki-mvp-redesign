import { findItemByName, ITEM_NAME_MAX } from "../../lib/items.js";
import { newWish, WISH_MAX, wishKgError, type Wish, type WishList } from "../../lib/wishlist.js";
import { Icon } from "../../components/Icon";
import { NoListing } from "./ItemSuggest";
import type { CatalogData } from "./types";

// 「欲しい食材」の一覧（一般向けの環境だけ）。行は品目＋必要量だけ。各行の「仕入れ案を見る」で、その品目の今までの流れへ進む。
// 品目はカタログ（登録済みの品目）から探すだけで、ここから品目を作ることはない。見つからなければ通常の状態として知らせる。

export { NO_LISTING } from "./ItemSuggest";

type Items = CatalogData["items"];

/** 行の品目名を登録済みの品目に照らす（表記の違いは同じ品目） */
export const wishItem = (w: Wish, items: Items) => (w.name.trim() ? findItemByName(w.name, items) : null);

export function WishListCard({ list, items, cond, onChange, onOpen }: {
  list: WishList; items: Items | null; cond: { desiredDate: string | null; slotId: string | null };
  onChange: (l: WishList) => void; onOpen: (w: Wish) => void;
}) {
  const setRow = (id: string, patch: Partial<Wish>) => onChange({ ...list, rows: list.rows.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const remove = (id: string) => {
    const rows = list.rows.filter((w) => w.id !== id);
    onChange({ rows: rows.length ? rows : [newWish()], active: list.active === id ? null : list.active });
  };
  return (
    <section className="wish-card" aria-labelledby="wish-title">
      <h2 className="wish-title" id="wish-title">欲しい食材</h2>
      <p className="item-help">品目と必要量を並べておけます。仕入れ案は1品目ずつ見られます。</p>
      <datalist id="wish-item-options">{(items ?? []).map((i) => <option key={i.id} value={i.name} />)}</datalist>
      <ul className="wish-rows">
        {list.rows.map((w, n) => {
          const item = items ? wishItem(w, items) : null;
          const kgError = wishKgError(w.kg);
          const none = !!items && !!w.name.trim() && !item;
          return (
            <li key={w.id} className={`wish-row ${list.active === w.id ? "active" : ""}`}>
              <div className="wish-inputs">
                <label className="wish-name">
                  <span className="sr-only">品目（{n + 1}行目）</span>
                  <input list="wish-item-options" value={w.name} maxLength={ITEM_NAME_MAX} placeholder="品目（例：トマト）" autoComplete="off"
                    onChange={(e) => setRow(w.id, { name: e.target.value })} />
                </label>
                <label className="with-unit wish-kg">
                  <span className="sr-only">必要量（{n + 1}行目）</span>
                  <input type="number" inputMode="numeric" min={1} max={100} step={1} value={w.kg} placeholder="10"
                    onChange={(e) => setRow(w.id, { kg: e.target.value })} />
                  <em>kg</em>
                </label>
              </div>
              {/* 登録されていない品目：近い食材の候補（押したときだけ、その品目に書き換えて仕入れ案へ進む） */}
              {none && <NoListing name={w.name} desiredDate={cond.desiredDate} slotId={cond.slotId}
                onPick={(i) => { setRow(w.id, { name: i.name }); onOpen({ ...w, name: i.name }); }} />}
              {item && item.name !== w.name.trim() && <p className="wish-note">「{item.name}」で探します</p>}
              {kgError && <p className="wish-note bad" role="status">{kgError}</p>}
              <div className="wish-actions">
                <button type="button" className="btn-secondary" disabled={!item || !!kgError} onClick={() => item && onOpen(w)}>
                  仕入れ案を見る<Icon name="arrowRight" size={18} />
                </button>
                {list.rows.length > 1 && (
                  <button type="button" className="text-btn" onClick={() => remove(w.id)} aria-label={`${w.name || `${n + 1}行目`}を一覧から消す`}>消す</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {list.rows.length < WISH_MAX && (
        <button type="button" className="btn-secondary btn-block wish-add" onClick={() => onChange({ ...list, rows: [...list.rows, newWish()] })}>
          ＋ 食材を追加
        </button>
      )}
    </section>
  );
}

/** 条件の確認・仕入れ案の画面の上：一覧のほかの品目へ切り替える（2品目以上あるときだけ） */
export function WishSwitch({ list, items, currentItemId, onOpen, onList }: {
  list: WishList; items: Items; currentItemId: string; onOpen: (w: Wish) => void; onList: () => void;
}) {
  const ready = list.rows.filter((w) => wishItem(w, items) && !wishKgError(w.kg));
  if (ready.length < 2) return null;
  return (
    <nav className="wish-switch" aria-label="欲しい食材">
      {ready.map((w) => {
        const label = `${wishItem(w, items)!.name}${w.kg.trim() ? ` ${w.kg.trim()}kg` : ""}`;
        // 表示中の品目：一覧から開いた行で、その品目をいま見ているとき
        return list.active === w.id && wishItem(w, items)!.id === currentItemId
          ? <span key={w.id} className="wish-chip on" aria-current="true">{label}</span>
          : <button key={w.id} type="button" className="wish-chip" onClick={() => onOpen(w)}>{label}</button>;
      })}
      <button type="button" className="text-btn wish-chip-list" onClick={onList}>一覧</button>
    </nav>
  );
}
