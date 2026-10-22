import { Navigate, Outlet } from "react-router";
import { guideOf, homeOf, landingOf, onboardingOf, PATHS } from "./paths";
import { useSession, type Role } from "./session";

// 画面の出し分け（UI 上のガード）。API の権限・本人確認はサーバー側で必ず行っている。
// ・未ログイン → トップ
// ・初回登録がまだ → 自分のロールの登録画面
// ・別のロールの URL → 自分のホーム

export function Loading() {
  return <main className="screen" aria-busy="true"><p className="muted">読み込み中…</p></main>;
}

/** ロール別の画面（ホーム・4つのタブ） */
export function RoleGate({ role }: { role: Role }) {
  const { me } = useSession();
  if (me === undefined) return <Loading />;
  if (!me) return <Navigate to={PATHS.welcome} replace />;
  if (!me.onboarded) return <Navigate to={onboardingOf(me.role)} replace />;
  if (me.role !== role) return <Navigate to={homeOf(me.role)} replace />;
  return <Outlet />;
}

/** 初回登録を終えた直後で、使い方（Guide）をまだ見ていない役割（このタブの sessionStorage） */
export const GUIDE_KEY = "ai-chiiki:guide";
export const guidePending = (role: Role) => { try { return sessionStorage.getItem(GUIDE_KEY) === role; } catch { return false; } };

/** 初回登録の画面。登録済みならホーム（登録した直後は使い方）へ、別のロールなら自分の登録画面へ */
export function OnboardingGate({ role }: { role: Role }) {
  const { me } = useSession();
  if (me === undefined) return <Loading />;
  if (!me) return <Navigate to={PATHS.welcome} replace />;
  if (me.onboarded) return <Navigate to={guidePending(me.role) ? guideOf(me.role) : homeOf(me.role)} replace />;
  if (me.role !== role) return <Navigate to={onboardingOf(me.role)} replace />;
  return <Outlet />;
}

/** ログイン前の画面（トップ・ログイン・新規登録・デモ）。ログイン済みなら行き先へ */
export function GuestGate() {
  const { me } = useSession();
  if (me === undefined) return <Loading />;
  if (me) return <Navigate to={landingOf(me)} replace />;
  return <Outlet />;
}

/** 存在しない URL：ログイン状態に合わせた画面へ */
export function FallbackRedirect() {
  const { me } = useSession();
  if (me === undefined) return <Loading />;
  return <Navigate to={me ? landingOf(me) : PATHS.welcome} replace />;
}
