import { useCallback, useEffect, useState } from "react";
import { Icon, Logo } from "./components/Icon";
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
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      if (r.status === 401) return setMe(null);
      if (!r.ok) throw new Error();
      setMe((await r.json()).user);
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

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <span className="brand"><Logo />AI地域商社</span>
          <span className="demo-tag">デモ・架空データ</span>
          {me && (
            <span className="session-box">
              <span className="session-name">
                <Icon name={me.role === "restaurant" ? "store" : "box"} size={16} />
                {me.displayName}
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
    </>
  );
}
