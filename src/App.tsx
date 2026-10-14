import { useEffect, useState } from "react";
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

function Home() {
  return (
    <>
      <h1>どちらで使いますか？</h1>
      <div className="entry-grid">
        <a href="#/restaurant" className="entry">
          <strong>仕入れ案を作る</strong>
          <span>飲食店：必要な食材・数量・希望日から、複数の生産者を組み合わせた仕入れ案を作ります</span>
        </a>
        <a href="#/producer" className="entry">
          <strong>販売できるものを登録</strong>
          <span>生産者：今回販売に回せる量と受渡条件を登録・変更します</span>
        </a>
      </div>
      <p className="muted small">表示されるのは取引相談に使う案です。注文確定・在庫予約・決済・配送は行いません。</p>
    </>
  );
}

export default function App() {
  const route = useHashRoute();
  return (
    <>
      <header className="site-header">
        <a href="#/">AI地域商社</a>
        <span className="demo-tag">デモ・架空データ</span>
      </header>
      <main className="container">{route === "/restaurant" ? <Restaurant /> : route === "/producer" ? <Producer /> : <Home />}</main>
    </>
  );
}
