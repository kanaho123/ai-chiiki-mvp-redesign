import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// ログイン状態（/api/me の結果）を画面全体で共有する。
// ここでの判定は画面の出し分けだけ。権限（ロール・本人確認）はすべてサーバー側の API で確認する。

export type Role = "restaurant" | "producer";
export type Me = {
  id: string;
  role: Role;
  displayName: string;
  producer: { id: string; farmName: string; originPrefecture: string } | null;
  onboarded: boolean;
};
export type AppMode = "general" | "demo";

type Session = {
  me: Me | null | undefined; // undefined は確認中
  appMode: AppMode | null; // null は確認できなかった
  demoNow: string | null; // デモ専用環境の基準日時
  loadError: boolean;
  setMe: (me: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

/** 初回登録の入力途中の内容など（このタブの sessionStorage）。ログアウトで消す */
const ONBOARDING_STORAGE_PREFIX = "ai-chiiki:onboarding:";
function clearOnboardingStorage() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(ONBOARDING_STORAGE_PREFIX)) sessionStorage.removeItem(k);
  } catch {}
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const [demoNow, setDemoNow] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/me", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setDemoNow(d.demoNow ?? null);
      if (d.appMode === "general" || d.appMode === "demo") setAppMode(d.appMode);
      if (r.status === 401) {
        setLoadError(false);
        return setMe(null);
      }
      if (!r.ok) throw new Error();
      setMe(d.user);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => void refresh();
    window.addEventListener("aic:unauthorized", onUnauthorized);
    return () => window.removeEventListener("aic:unauthorized", onUnauthorized);
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearOnboardingStorage();
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, appMode, demoNow, loadError, setMe, refresh, logout }), [me, appMode, demoNow, loadError, refresh, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("SessionProvider の中で使ってください");
  return s;
}

/** ログイン中の画面（ガードを通った後）で使う。ログインしていない状態では呼ばない */
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("ログイン中の画面で使ってください");
  return me;
}
