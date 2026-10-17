import { useCallback, useEffect, useState } from "react";
import { Icon, Logo } from "./components/Icon";
import { formatJstDateTime } from "./lib/dates.js";
import Onboarding from "./pages/Onboarding";
import Producer from "./pages/Producer";
import Restaurant from "./pages/Restaurant";
import RoleSelect from "./pages/RoleSelect";

// アプリの枠：初回はオンボーディング → 役割選択（ログイン）→ 役割ごとの画面。
// 権限の判定はサーバー側（/api/me・各 API）で行い、画面は表示を切り替えるだけ。
export type Me = {
  id: string;
  role: "restaurant" | "producer";
  displayName: string;
  producer: { id: string; farmName: string; originPrefecture: string } | null;
};

// オンボーディングを見終わったか（端末ごとの表示の都合だけに使う。読めなければ毎回表示）
const ONBOARDED_KEY = "ai-chiiki:onboarded:v1";
const readOnboarded = () => { try { return localStorage.getItem(ONBOARDED_KEY) === "1"; } catch { return false; } };
const writeOnboarded = () => { try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch {} };

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined は確認中
  const [demoNow, setDemoNow] = useState<string | null>(null); // デモ専用環境の基準日時
  const [loadError, setLoadError] = useState(false);
  const [onboarded, setOnboarded] = useState(readOnboarded);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setDemoNow(d.demoNow ?? null);
      if (r.status === 401) return setMe(null);
      if (!r.ok) throw new Error();
      setMe(d.user);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
  }

  if (me === undefined) return <main className="screen"><p className="muted">読み込み中…</p></main>;

  // 未ログインで初回ならオンボーディング（ログイン済みの人には出さない）
  if (!me && !onboarded) return <Onboarding onDone={() => { writeOnboarded(); setOnboarded(true); }} />;

  // 役割で画面の主役の色を切り替える（飲食店＝緑、生産者＝オレンジ）。文字でも役割を示す
  const roleClass = me ? `role-${me.role}` : "role-guest";
  const roleText = me?.role === "restaurant" ? "飲食店" : "生産者";
  const name = me?.role === "producer" ? me.producer?.farmName ?? me.displayName : me?.displayName;

  return (
    <div className={roleClass}>
      <header className="app-header">
        <div className="app-header-inner">
          {me ? (
            <>
              <span className="who session-name" aria-label={`${name}（${roleText}）として操作中`}>
                <span className="who-icon" aria-hidden="true"><Icon name={me.role === "restaurant" ? "store" : "sprout"} /></span>
                <span className="who-text">
                  <span className="who-role">{roleText}</span>
                  <span className="who-name">{name}</span>
                </span>
              </span>
              {demoNow && <span className="demo-tag" title={`デモの基準日時 ${formatJstDateTime(demoNow)}`}>デモ</span>}
              <button type="button" className="header-btn logout" onClick={logout}>ログアウト</button>
            </>
          ) : (
            <>
              <span className="app-brand"><Logo />AI地域商社</span>
              {demoNow && <span className="demo-tag" title={`デモの基準日時 ${formatJstDateTime(demoNow)}`}>デモ</span>}
            </>
          )}
        </div>
      </header>
      {loadError && <div className="screen"><div className="alert bad" role="alert"><Icon name="alert" />ログイン状態を確認できませんでした。再読み込みしてください。</div></div>}
      {!me ? <RoleSelect onLoggedIn={setMe} /> : me.role === "restaurant" ? <Restaurant me={me} /> : <Producer me={me} />}
    </div>
  );
}
