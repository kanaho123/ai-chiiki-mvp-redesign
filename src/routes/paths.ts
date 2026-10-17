import type { IconName } from "../components/Icon";
import type { Me, Role } from "./session";

// 画面の URL と、ログイン状態ごとの行き先。ここで決めるのは画面の出し分けだけ（権限はサーバー側で確認する）。

export const PATHS = {
  welcome: "/",
  login: "/login",
  signup: "/signup",
  demo: "/demo",
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

/** 一般向けの環境から案内するデモ環境（デモ用のデータだけが入った別の環境） */
export const DEMO_APP_URL: string = import.meta.env.VITE_DEMO_APP_URL || "https://ai-chiiki-mvp-redesign.vercel.app/";
