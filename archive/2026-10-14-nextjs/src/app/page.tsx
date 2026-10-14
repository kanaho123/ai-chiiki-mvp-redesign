import Link from "next/link";

export default function Home() {
  return (
    <>
      <h1>どちらで使いますか？</h1>
      <div className="entry-grid">
        <Link href="/restaurant" className="entry">
          <strong>仕入れ案を作る</strong>
          <span>飲食店：必要な食材・数量・希望日から、複数の生産者を組み合わせた仕入れ案を作ります</span>
        </Link>
        <Link href="/producer" className="entry">
          <strong>販売できるものを登録</strong>
          <span>生産者：今回販売に回せる量と受渡条件を登録・変更します</span>
        </Link>
      </div>
      <p className="muted small">
        表示されるのは取引相談に使う案です。注文確定・在庫予約・決済・配送は行いません。
      </p>
    </>
  );
}
