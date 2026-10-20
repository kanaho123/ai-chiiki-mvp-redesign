import { findItemByName, ITEM_NAME_MAX } from "../../lib/items.js";
import { newWish, WISH_MAX, wishKgError, type Wish, type WishList } from "../../lib/wishlist.js";
import type { CatalogData } from "./types";

// 「欲しい食材」の一覧（一般向けの環境だけ）。行は品目＋必要量だけ。確認の画面に置き、1行目（いま確認する食材）は確認のフォームそのもの。
// 品目はカタログ（登録済みの品目）から探すだけで、ここから品目を作ることはない。見つからなければ通常の状態として知らせる。

export { NO_LISTING } from "./ItemSuggest";

type Items = CatalogData["items"];

/** 行の品目名を登録済みの品目に照らす（表記の違いは同じ品目） */
export const wishItem = (w: Wish, items: Items) => (w.name.trim() ? findItemByName(w.name, items) : null);

/**
 * 確認の画面の「欲しい食材」の2行目以降（品目＋必要量だけ）。1行目（いま確認する食材）は確認のフォームの品目・数量そのもの。
 * 仕入れ案は1品目ずつなので、行ごとの「仕入れ案を見る」は置かない。「この食材を確認する」でその食材を1行目にする。
 */
export function ExtraWishRows({ list, onChange, onPick }: { list: WishList; onChange: (l: WishList) => void; onPick: (w: Wish) => void }) {
  const others = list.rows.filter((w) => w.id !== list.active);
  const setRow = (id: string, patch: Partial<Wish>) => onChange({ ...list, rows: list.rows.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const remove = (id: string) => onChange({ ...list, rows: list.rows.filter((w) => w.id !== id) });
  return (
    <>
      {others.length > 0 && (
        <ul className="wish-rows" aria-label="ほかの食材">
          {others.map((w, n) => {
            const kgError = wishKgError(w.kg);
            return (
              <li key={w.id} className="wish-row">
                <div className="wish-inputs">
                  <label className="wish-name">
                    <span className="sr-only">品目（ほかの食材 {n + 1}）</span>
                    <input type="text" className="wish-item" value={w.name} maxLength={ITEM_NAME_MAX} placeholder="例：キャベツ、万願寺とうがらし" autoComplete="off"
                      onChange={(e) => setRow(w.id, { name: e.target.value })} />
                  </label>
                  <label className="with-unit wish-kg">
                    <span className="sr-only">必要量（ほかの食材 {n + 1}）</span>
                    <input type="number" inputMode="numeric" min={1} max={100} step={1} value={w.kg} placeholder="10"
                      onChange={(e) => setRow(w.id, { kg: e.target.value })} />
                    <em>kg</em>
                  </label>
                </div>
                {kgError && <p className="wish-note bad" role="status">{kgError}</p>}
                <div className="wish-actions">
                  <button type="button" className="text-btn" disabled={!w.name.trim()} onClick={() => onPick(w)}>この食材を確認する</button>
                  <button type="button" className="text-btn" onClick={() => remove(w.id)} aria-label={`${w.name || `ほかの食材 ${n + 1}`}を一覧から消す`}>消す</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {list.rows.length < WISH_MAX && (
        <button type="button" className="btn-secondary btn-block wish-add" onClick={() => onChange({ ...list, rows: [...list.rows, newWish()] })}>
          ＋ 食材を追加
        </button>
      )}
    </>
  );
}

/** 仕入れ案の画面の上：一覧のほかの食材へ切り替える（2品目以上あるときだけ）。「一覧」で確認の画面の「欲しい食材」へ戻る */
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
