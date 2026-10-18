import type { IconName } from "../components/Icon";
import type { Me, Role } from "./session";

// 画面の URL と、ログイン状態ごとの行き先。ここで決めるのは画面の出し分けだけ（権限はサーバー側で確認する）。

export const PATHS = {
  welcome: "/",
  login: "/login",
  signup: "/signup",
  demo: "/demo",
  terms: "/terms",
  privacy: "/privacy",
  restaurant: {
    home: "/restaurant/home",
    buy: "/restaurant/buy",
    consultations: "/restaurant/consultations",
    mypage: "/restaurant/mypage",
  },
  producer: {
    home: "/producer/home",
    listings: "/producer/listings",
    requests: "/producer/requests",
    mypage: "/producer/mypage",
  },
  onboarding: { restaurant: "/onboarding/restaurant", producer: "/onboarding/producer" },
} as const;

export const homeOf = (role: Role) => PATHS[role].home;
export const onboardingOf = (role: Role) => PATHS.onboarding[role];

/** ログイン済みのユーザーが最初に行く画面：初回登録が済んでいなければ登録、済んでいればホーム */
export const landingOf = (me: Me) => (me.onboarded ? homeOf(me.role) : onboardingOf(me.role));

/** 下部ナビの項目。badge は将来「依頼」の未対応件数などを出すためのキー */
export type NavItem = { to: string; label: string; icon: IconName; badge?: "producerRequests" | "restaurantConsultations" };

export const NAV: Record<Role, NavItem[]> = {
  restaurant: [
    { to: PATHS.restaurant.home, label: "ホーム", icon: "home" },
    { to: PATHS.restaurant.buy, label: "仕入れる", icon: "basket" },
    { to: PATHS.restaurant.consultations, label: "相談", icon: "chat", badge: "restaurantConsultations" },
    { to: PATHS.restaurant.mypage, label: "マイページ", icon: "user" },
  ],
  producer: [
    { to: PATHS.producer.home, label: "ホーム", icon: "home" },
    { to: PATHS.producer.listings, label: "出品", icon: "box" },
    { to: PATHS.producer.requests, label: "依頼", icon: "clipboard", badge: "producerRequests" },
    { to: PATHS.producer.mypage, label: "マイページ", icon: "user" },
  ],
};

/**
 * 一般向けの環境とデモ用の環境は、同じコードを別々の URL で公開する。お互いの URL はビルド時の環境変数で設定する（コードに書かない）。
 * ・VITE_DEMO_APP_URL：一般向けの環境に設定。デモ用の環境の URL（例：https://…）。「デモを試す」はその /demo へ
 * ・VITE_GENERAL_APP_URL：デモ用の環境に設定。一般向けの環境の URL。「一般向けのサービスへ」の戻り先
 * 未設定・不正な値ならリンクを出さない。https だけを使う（開発中だけ localhost の http も可）
 */
export function appUrl(raw: string | undefined, dev = import.meta.env.DEV): string | null {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const u = new URL(v);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol === "https:" && !local) return u.origin;
    if (dev && u.protocol === "http:" && local) return u.origin;
  } catch {}
  return null;
}
/** デモ用の環境の入口（/demo）。未設定なら null */
export const demoEntryUrl = (base = appUrl(import.meta.env.VITE_DEMO_APP_URL)) => (base ? `${base}${PATHS.demo}` : null);
/** 一般向けの環境のトップ。未設定なら null */
export const generalHomeUrl = (base = appUrl(import.meta.env.VITE_GENERAL_APP_URL)) => (base ? `${base}/` : null);
