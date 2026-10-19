import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { PATHS } from "../../routes/paths";
import { ErrorRetry } from "./ErrorRetry";
import { useSupplies, yen, type SupplyRow } from "./data";

// 生産者のマイページの最初に出す「いま出品しているもの」。スマートフォンで上から
//   品目 → 状態（公開中／止めています／売り切れ）→ 残り → 価格 → 「編集する」
// の順に読めるようにする。変更（数量・価格・公開）は「出品」の画面のその商品のところで行う。

/** 出品の状態（生産者に見せる言葉）。0kg は公開中でも「売り切れ」 */
export function listingState(s: Pick<SupplyRow, "availableKg" | "published">): { key: "soldout" | "on" | "off"; label: string } {
  if (s.availableKg === 0) return { key: "soldout", label: "売り切れ" };
  return s.published ? { key: "on", label: "公開中" } : { key: "off", label: "止めています" };
}

/** 「出品」の画面で、その商品のところへ移動するための目印 */
export const supplyAnchor = (id: string) => `supply-${id}`;

export function ListingsSummary() {
  const { data, error, reload } = useSupplies();
  const rows = data?.supplies ?? [];
  return (
    <section className="listings-summary" aria-labelledby="my-listings-title">
      <h2 className="section-title" id="my-listings-title">いま出品しているもの</h2>
      {error && <ErrorRetry text={error} onRetry={reload} />}
      {!data && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {data && rows.length === 0 && <p className="empty-note">まだ出品はありません</p>}
      {rows.length > 0 && (
        <ul className="my-listings">
          {rows.map((s) => {
            const state = listingState(s);
            const name = `${s.item.name}${s.variety.name !== "指定なし" ? `（${s.variety.name}）` : ""}`;
            return (
              <li key={s.id} className={`my-listing ${state.key}`}>
                <span className="my-listing-name">
                  {name}
                  {s.grade === "irregular" && <span className="my-listing-tag">規格外</span>}
                </span>
                <span className="my-listing-state">{state.label}</span>
                <span className="my-listing-qty">残り <b className="num">{s.availableKg}kg</b></span>
                <span className="my-listing-price">価格 <b className="num">{yen(s.priceYenPerKg)}</b>/kg</span>
                <Link className="btn-secondary btn-block link-btn my-listing-edit" to={`${PATHS.producer.listings}#${supplyAnchor(s.id)}`} aria-label={`${name}を編集する`}>
                  <Icon name="edit" />編集する
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data && rows.length === 0 && <Link className="btn-secondary btn-block link-btn" to={PATHS.producer.listings}><Icon name="box" />出品する</Link>}
    </section>
  );
}
