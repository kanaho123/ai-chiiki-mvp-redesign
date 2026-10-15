import { useEffect, useState } from "react";
import { Icon, Logo } from "./components/Icon";
import type { SupplyListing } from "./lib/allocate.js";
import { formatDateJa, jstDate } from "./lib/dates.js";
import Producer from "./pages/Producer";
import Restaurant from "./pages/Restaurant";

// 画面は少ないので、URL の # で切り替える（#/restaurant、#/producer）
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

type PreviewRow = { item: string; unit: string; quantity: number; listings: number; firstDate: string };

/** 公開中の出品を品目ごとにまとめる（現在の DB の値だけを使う） */
function usePreview() {
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/listings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { listings: SupplyListing[] }) => {
        const today = jstDate();
        // 品目と単位ごとにまとめる（kg と個は合算しない）
        const map = new Map<string, PreviewRow>();
        for (const l of d.listings) {
          // 公開停止・在庫0・受渡日を過ぎた出品は「今受け取れる食材」として出さない
          if (!l.isPublic || l.quantity <= 0 || l.availableDate < today) continue;
          const key = `${l.item}|${l.unit}`;
          const cur = map.get(key) ?? { item: l.item, unit: l.unit, quantity: 0, listings: 0, firstDate: l.availableDate };
          cur.quantity += l.quantity;
          cur.listings += 1;
          if (l.availableDate < cur.firstDate) cur.firstDate = l.availableDate;
          map.set(key, cur);
        }
        setRows([...map.values()].sort((a, b) => b.quantity - a.quantity));
      })
      .catch(() => setFailed(true));
  }, []);
  return { rows, failed };
}

function Home() {
  const { rows, failed } = usePreview();
  return (
    <div className="home">
      <div className="home-main">
        <section className="home-intro">
          <h1><span className="nowrap">地域の農家から、</span><span className="nowrap">必要な量を仕入れる</span></h1>
          <p>
            1軒では足りない量も、近くの複数の農家を組み合わせて1つの仕入れ案にします。数量・金額・受渡しを確かめてから、取引の相談に進めます。
          </p>
        </section>

        <div className="home-entries" style={{ display: "grid", gap: 12 }}>
          <section className="entry-buyer" aria-labelledby="entry-buyer-title">
            <span className="entry-role">
              <span className="icon-wrap"><Icon name="store" /></span>
              飲食店の方
            </span>
            <h2 id="entry-buyer-title">仕入れたい食材と量から、案を作る</h2>
            <ol className="entry-steps">
              <li>品目・数量・希望日を入れる</li>
              <li>条件の合う農家の組み合わせを確認する</li>
              <li>数量・商品代・受渡しを見て、相談に進む</li>
            </ol>
            <a href="#/restaurant" className="button primary large block">
              仕入れ案を作る
              <Icon name="arrowRight" />
            </a>
          </section>

          <a href="#/producer" className="entry-grower">
            <span className="icon-wrap"><Icon name="box" size={22} /></span>
            <span>
              <span className="role">生産者の方</span>
              <span className="title">販売する野菜を登録・変更する</span>
            </span>
            <Icon name="chevronRight" className="chev" />
          </a>
        </div>
      </div>

      <section className="home-preview" aria-labelledby="preview-title">
        <div className="preview-head">
          <h2 id="preview-title">登録されている食材</h2>
          <a href="#/producer">出品を見る</a>
        </div>
        {failed ? (
          <p className="alert bad"><Icon name="alert" />出品を読み込めませんでした。時間をおいて再読み込みしてください。</p>
        ) : rows === null ? (
          <p className="preview-empty">読み込み中…</p>
        ) : rows.length === 0 ? (
          <p className="preview-empty">公開中の出品はまだありません。</p>
        ) : (
          <ul className="preview-list">
            {rows.map((r) => (
              <li key={`${r.item}|${r.unit}`}>
                <span className="preview-item">{r.item}</span>
                <span className="preview-qty num">{r.quantity}<small>{r.unit}</small></span>
                <span className="preview-sub">
                  {r.listings}件の出品の合計・最も早い受渡し {formatDateJa(r.firstDate)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="preview-note">公開中で、受渡日がこれからの出品の販売可能量です。単位が違うもの（kgと個）は分けて表示します。仕入れ案を作っても、この数量は確保されません。</p>
      </section>

      <p className="home-about">
        このページはデモです。表示される農家・在庫・価格はすべて架空のデータで、注文確定・在庫の確保・決済・配送は行いません。
      </p>
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <a href="#/" className="brand"><Logo />AI地域商社</a>
          <span className="demo-tag">デモ・架空データ</span>
        </div>
      </header>
      <main className="container">{route === "/restaurant" ? <Restaurant /> : route === "/producer" ? <Producer /> : <Home />}</main>
    </>
  );
}
