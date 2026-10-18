import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigationType } from "react-router";
import { AppShell, GuestShell, OnboardingShell } from "./components/AppShell";
import { PATHS } from "./routes/paths";
import { SessionProvider, useMe } from "./routes/session";
import Producer from "./pages/Producer";
import Restaurant from "./pages/Restaurant";
import { Demo, Login, Signup, Welcome } from "./pages/Guest";
import ProducerOnboarding from "./pages/onboarding/ProducerOnboarding";
import RestaurantOnboarding from "./pages/onboarding/RestaurantOnboarding";
import MyPage from "./pages/daily/MyPage";
import { ProducerHome, ProducerRequests } from "./pages/daily/Producer";
import { RestaurantConsultationDetail, RestaurantConsultations, RestaurantHome } from "./pages/daily/Restaurant";
import { FallbackRedirect, GuestGate, OnboardingGate, RoleGate } from "./routes/guards";

// アプリの枠：URL ごとの画面とガード。
// 権限の判定はサーバー側（/api/me・各 API）で行い、ここでは画面の出し分けだけを行う。
export type { Me } from "./routes/session";

/** 新しい画面に進んだときは先頭から表示する（戻る・進むのときはブラウザの位置に任せる） */
function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if (type !== "POP") window.scrollTo(0, 0);
  }, [pathname, type]);
  return null;
}

// 既存の仕入れ・在庫の画面は、ログイン中のユーザーを props で受け取る
const RestaurantBuy = () => <Restaurant me={useMe()} />;
const ProducerListings = () => <Producer me={useMe()} />;

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <ScrollToTop />
        <AppRoutes />
      </BrowserRouter>
    </SessionProvider>
  );
}

/** URL ごとの画面（テストでは MemoryRouter の中で使う） */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestGate />}>
        <Route element={<GuestShell />}>
          <Route path={PATHS.welcome} element={<Welcome />} />
          <Route path={PATHS.login} element={<Login />} />
          <Route path={PATHS.signup} element={<Signup />} />
          <Route path={PATHS.demo} element={<Demo />} />
        </Route>
      </Route>

      <Route path="/restaurant" element={<RoleGate role="restaurant" />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={PATHS.restaurant.home} replace />} />
          <Route path="home" element={<RestaurantHome />} />
          <Route path="buy" element={<RestaurantBuy />} />
          <Route path="consultations" element={<RestaurantConsultations />} />
          <Route path="consultations/:id" element={<RestaurantConsultationDetail />} />
          <Route path="mypage" element={<MyPage />} />
          <Route path="*" element={<Navigate to={PATHS.restaurant.home} replace />} />
        </Route>
      </Route>

      <Route path="/producer" element={<RoleGate role="producer" />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={PATHS.producer.home} replace />} />
          <Route path="home" element={<ProducerHome />} />
          <Route path="listings" element={<ProducerListings />} />
          <Route path="requests" element={<ProducerRequests />} />
          <Route path="mypage" element={<MyPage />} />
          <Route path="*" element={<Navigate to={PATHS.producer.home} replace />} />
        </Route>
      </Route>

      <Route path={`${PATHS.onboarding.restaurant}/*`} element={<OnboardingGate role="restaurant" />}>
        <Route element={<OnboardingShell />}>
          <Route path="*" element={<RestaurantOnboarding />} />
        </Route>
      </Route>
      <Route path={`${PATHS.onboarding.producer}/*`} element={<OnboardingGate role="producer" />}>
        <Route element={<OnboardingShell />}>
          <Route path="*" element={<ProducerOnboarding />} />
        </Route>
      </Route>

      <Route path="*" element={<FallbackRedirect />} />
    </Routes>
  );
}
