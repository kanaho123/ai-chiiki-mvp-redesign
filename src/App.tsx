import { useCallback, useEffect, useState } from "react";
import { Icon, Logo } from "./components/Icon";
import { formatJstDateTime } from "./lib/dates.js";
import Login from "./pages/Login";
import Producer from "./pages/Producer";
import Restaurant from "./pages/Restaurant";

// ログイン状態で入口を分ける。権限の判定はサーバー側（/api/me・各 API）で行い、画面は表示を切り替えるだけ。
export type Me = {
  id: string;
  role: "restaurant" | "producer";
  displayName: string;
  producer: { id: string; farmName: string; originPrefecture: string } | null;
};

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined は確認中
  const [demoNow, setDemoNow] = useState<string | null>(null); // デモ専用環境の基準日時
  const [loadError, setLoadError] = useState(false);

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

  // 役割で画面の主役の色を切り替える（飲食店＝緑、生産者＝オレンジ）。文字でも役割を示す
  const roleClass = me ? `role-${me.role}` : "role-guest";

  return (
    <div className={roleClass}>
      <header className="site-header">
        <div className="site-header-inner">
          <span className="brand"><Logo />AI地域商社</span>
          <span className="demo-tag">
            {demoNow ? (
              <>
                <span className="tag-long">デモ基準日時 {formatJstDateTime(demoNow)}・架空データ</span>
                <span className="tag-short">デモ {formatJstDateTime(demoNow).replace(/月/, "/").replace(/日/, "")}・架空</span>
              </>
            ) : "デモ・架空データ"}
          </span>
          {me && (
            <span className="session-box">
              {/* いま誰として操作しているかを常に表示する（飲食店⇔生産者の切り替えを見失わない） */}
              <span className={`session-name role-${me.role}`} aria-label={`${me.displayName}（${me.role === "restaurant" ? "飲食店" : "生産者"}）として操作中`}>
                <Icon name={me.role === "restaurant" ? "store" : "box"} size={16} />
                <span className="session-role">{me.role === "restaurant" ? "飲食店" : "生産者"}</span>
                <span className="session-display">{me.displayName}</span>
                <span className="session-suffix">として操作中</span>
              </span>
              <button type="button" className="ghost" onClick={logout}>ログアウト</button>
            </span>
          )}
        </div>
      </header>
      <main className="container">
        {loadError && <div className="alert bad" role="alert"><Icon name="alert" />ログイン状態を確認できませんでした。再読み込みしてください。</div>}
        {me === undefined ? (
          <p className="muted">読み込み中…</p>
        ) : me === null ? (
          <Login onLoggedIn={setMe} />
        ) : me.role === "restaurant" ? (
          <Restaurant me={me} />
        ) : (
          <Producer me={me} />
        )}
      </main>
    </div>
  );
}
