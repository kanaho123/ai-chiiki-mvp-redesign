import { useEffect, useState } from "react";
import { Link } from "react-router";
import { nameOf, ROLE_TEXT } from "../components/AppShell";
import { Icon } from "../components/Icon";
import { PATHS } from "../routes/paths";
import { useMe, useSession } from "../routes/session";
import { WELCOME_KEY } from "./onboarding/parts";
import { ProducerConfirmations } from "./ProducerConfirmations";

// まだ作り込んでいない画面の最小の枠（Phase 3 以降で中身を置き換える）。
// 各画面とも、見出し＋その画面でいちばん大事な操作（原則1つ）だけを置く。

/** 初回登録を終えた直後に1回だけ出すお知らせ */
function WelcomeNotice({ role, text }: { role: "restaurant" | "producer"; text: string }) {
  const [show] = useState(() => { try { return sessionStorage.getItem(WELCOME_KEY) === role; } catch { return false; } });
  useEffect(() => { try { sessionStorage.removeItem(WELCOME_KEY); } catch {} }, []);
  if (!show) return null;
  return <div className="alert ok" role="status"><Icon name="check" /><div><b>登録が完了しました</b><br />{text}</div></div>;
}

export function RestaurantHome() {
  const me = useMe();
  return (
    <main className="screen">
      <div className="title-block">
        <span className="eyebrow">ホーム</span>
        <h1 className="display">{nameOf(me)}</h1>
      </div>
      <WelcomeNotice role="restaurant" text="さっそく、欲しい食材の仕入れ案をつくってみましょう。" />
      <Link className="btn-primary btn-block link-btn" to={PATHS.restaurant.buy}><Icon name="basket" />新しい仕入れ案をつくる</Link>
    </main>
  );
}

export function RestaurantConsultations() {
  return (
    <main className="screen">
      <div className="title-block">
        <h1 className="display">相談</h1>
        <p className="muted">生産者に確認を依頼した仕入れが、ここに並びます。</p>
      </div>
    </main>
  );
}

export function ProducerHome() {
  const me = useMe();
  return (
    <main className="screen">
      <div className="title-block">
        <span className="eyebrow">ホーム</span>
        <h1 className="display">{nameOf(me)}</h1>
      </div>
      <WelcomeNotice role="producer" text="次は、今日出せる野菜と量を登録しましょう。" />
      <Link className="btn-primary btn-block link-btn" to={PATHS.producer.listings}><Icon name="box" />今日出せる量を更新する</Link>
    </main>
  );
}

/** 生産者の「依頼」：飲食店からの確認依頼（承認／NG と連絡先の開示）。中身はこれまでの確認依頼の画面そのもの */
export function ProducerRequests() {
  return (
    <main className="screen">
      <h1 className="display">依頼</h1>
      <ProducerConfirmations />
    </main>
  );
}

export function MyPage() {
  const me = useMe();
  const { logout } = useSession();
  return (
    <main className="screen">
      <h1 className="display">マイページ</h1>
      <dl className="account-rows">
        <div><dt>使い方</dt><dd>{ROLE_TEXT[me.role]}</dd></div>
        <div><dt>{me.role === "producer" ? "農園名" : "店舗名"}</dt><dd>{nameOf(me)}</dd></div>
      </dl>
      <button type="button" className="btn-secondary btn-block" onClick={logout}><Icon name="logout" />ログアウト</button>
    </main>
  );
}
