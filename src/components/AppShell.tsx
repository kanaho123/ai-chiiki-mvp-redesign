import { useLayoutEffect, useRef } from "react";
import { NavLink, Outlet } from "react-router";
import { formatJstDateTime } from "../lib/dates.js";
import { NAV, type NavItem } from "../routes/paths";
import { InboxProvider, useInbox } from "../routes/inbox";
import { useSession, type Me } from "../routes/session";
import { Icon, Logo } from "./Icon";

// ログイン後の共通の枠：上のヘッダー（役割・名前）＋本文＋下部ナビ（4つのタブ）。
// 役割で画面の主役の色を切り替える（飲食店＝緑、生産者＝オレンジ）。役割は文字でも示す。

export const ROLE_TEXT = { restaurant: "飲食店", producer: "生産者" } as const;
export const nameOf = (me: Me) => (me.role === "producer" ? me.producer?.farmName ?? me.displayName : me.displayName);
/** 初回登録の途中は、まだ店舗名・農園名がないので「登録中」と出す */
const headerName = (me: Me) => (me.onboarded ? nameOf(me) : "登録中");

export function AppHeader({ me, children }: { me: Me | null; children?: React.ReactNode }) {
  const { demoNow } = useSession();
  const demo = demoNow && <span className="demo-tag" title={`デモの基準日時 ${formatJstDateTime(demoNow)}`}>デモ</span>;
  return (
    <header className="app-header">
      <div className="app-header-inner">
        {me ? (
          <>
            <Logo size={30} />
            <span className="who session-name" aria-label={`${headerName(me)}（${ROLE_TEXT[me.role]}）として操作中`}>
              <span className="who-role">{ROLE_TEXT[me.role]}</span>
              <span className="who-name">{headerName(me)}</span>
            </span>
            {demo}
          </>
        ) : (
          <>
            <span className="app-brand"><Logo />AI地域商社</span>
            {demo}
          </>
        )}
        {children}
      </div>
    </header>
  );
}

/** 未対応件数（サーバーの実データ）。0 件ならバッジは出さない */
function useBadgeCounts(): Record<NonNullable<NavItem["badge"]>, number> {
  return useInbox().counts;
}

export function BottomNav({ me }: { me: Me }) {
  const ref = useRef<HTMLElement>(null);
  const counts = useBadgeCounts();
  // 実際の高さを --nav-h として測り、本文の下余白と、主ボタンの固定領域の位置に使う（重ならないように）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--nav-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    root.classList.add("has-nav");
    return () => {
      ro.disconnect();
      root.classList.remove("has-nav");
      root.style.removeProperty("--nav-h");
    };
  }, []);
  return (
    <nav ref={ref} className="bottom-nav" aria-label="メニュー">
      <ul className="bottom-nav-inner">
        {NAV[me.role].map((item) => {
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <li key={item.to}>
              <NavLink to={item.to} className="nav-item">
                <span className="nav-icon"><Icon name={item.icon} size={26} />{count > 0 && <span className="nav-badge" aria-hidden="true">{count > 99 ? "99+" : count}</span>}</span>
                <span className="nav-label">{item.label}</span>
                {count > 0 && <span className="sr-only">（未対応 {count}件）</span>}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell() {
  const { me } = useSession();
  if (!me) return null; // ガード（RoleGate）の内側でだけ使う
  return (
    <InboxProvider>
      <div className={`role-${me.role}`}>
        <AppHeader me={me} />
        <Outlet />
        <BottomNav me={me} />
      </div>
    </InboxProvider>
  );
}

/** 初回登録の画面の枠（下部ナビは出さない。途中でやめられるようログアウトだけ置く） */
export function OnboardingShell() {
  const { me, logout } = useSession();
  if (!me) return null;
  return (
    <div className={`role-${me.role}`}>
      <AppHeader me={me}>
        <button type="button" className="text-btn header-action" onClick={logout}><Icon name="logout" />ログアウト</button>
      </AppHeader>
      <Outlet />
    </div>
  );
}

/** ログイン前の画面の枠 */
export function GuestShell() {
  const { loadError } = useSession();
  return (
    <div className="role-guest">
      <AppHeader me={null} />
      {loadError && <div className="screen"><div className="alert bad" role="alert"><Icon name="alert" />ログイン状態を確認できませんでした。再読み込みしてください。</div></div>}
      <Outlet />
    </div>
  );
}
