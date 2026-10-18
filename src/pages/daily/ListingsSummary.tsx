import { Link } from "react-router";
import { Icon } from "../../components/Icon";
import { formatJstDateTime } from "../../lib/dates";
import { PATHS } from "../../routes/paths";
import { ErrorRetry } from "./ErrorRetry";
import { useSupplies, yen } from "./data";

// 生産者のマイページの最初に出す「いま出品しているもの」（品目・数量・価格・公開／停止・更新日時）。
// 変更（数量・価格・公開停止／再開）は「出品」の画面で行う（ここでは見るだけ）。
export function ListingsSummary() {
  const { data, error, reload } = useSupplies();
  const rows = data?.supplies ?? [];
  const published = rows.filter((s) => s.published).length;
  return (
    <section className="listings-summary" aria-labelledby="my-listings-title">
      <div className="profile-head">
        <h2 className="section-title" id="my-listings-title">いま出品しているもの</h2>
        {data && <span className="listings-count">公開中 {published}件 / 全{rows.length}件</span>}
      </div>
      {error && <ErrorRetry text={error} onRetry={reload} />}
      {!data && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {data && rows.length === 0 && <p className="empty-note">まだ出品はありません</p>}
      {rows.length > 0 && (
        <ul className="my-listings">
          {rows.map((s) => (
            <li key={s.id} className={`my-listing ${s.published ? "on" : "off"}`}>
              <span className="my-listing-name">
                {s.item.name}{s.variety.name !== "指定なし" && `（${s.variety.name}）`}
                {s.grade === "irregular" && <span className="my-listing-tag">規格外</span>}
              </span>
              <span className="my-listing-state">{s.published ? "公開中" : "停止中"}</span>
              <span className="my-listing-qty num">{s.availableKg}kg・{yen(s.priceYenPerKg)}/kg</span>
              {!Number.isNaN(Date.parse(s.updatedAt)) && <span className="my-listing-updated">更新：{formatJstDateTime(s.updatedAt)}</span>}
            </li>
          ))}
        </ul>
      )}
      <Link className="btn-secondary btn-block link-btn" to={PATHS.producer.listings}><Icon name="box" />数量・価格・公開を変更する</Link>
    </section>
  );
}
