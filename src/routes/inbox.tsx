import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";

// 下部ナビの件数（例：生産者の「依頼」の未対応件数）。数はサーバー（/api/inbox）の実データを正とし、
// 画面を移動したとき・画面に戻ってきたとき・返事をしたとき（refresh）に読み直す。

export type InboxCounts = { producerRequests: number; restaurantConsultations: number };
const EMPTY: InboxCounts = { producerRequests: 0, restaurantConsultations: 0 };
const InboxContext = createContext<{ counts: InboxCounts; refresh: () => void }>({ counts: EMPTY, refresh: () => {} });

export function InboxProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<InboxCounts>(EMPTY);
  const [tick, setTick] = useState(0);
  const { pathname } = useLocation();
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/inbox", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setCounts({ ...EMPTY, producerRequests: Number(d.producerRequests) || 0 }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [pathname, tick]);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const value = useMemo(() => ({ counts, refresh }), [counts, refresh]);
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}

export const useInbox = () => useContext(InboxContext);
