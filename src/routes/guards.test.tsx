// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { SessionProvider, type Me } from "./session";

// 画面の出し分け（UI のルーティング）の回帰テスト。
// ブラウザ側の /api/me の応答だけを差し替えて、URL ごとにどの画面へ案内されるかを確かめる。
// サーバー側の権限確認（ロール・本人確認）は server/*.test.ts で別に確かめており、ここでは置き換えない。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const restaurant = (onboarded: boolean): Me => ({ id: "u-r", role: "restaurant", displayName: "テスト食堂", producer: null, onboarded });
const producer = (onboarded: boolean): Me => ({
  id: "u-p", role: "producer", displayName: "テスト農園", onboarded,
  producer: onboarded ? { id: "p-1", farmName: "テスト農園", originPrefecture: "大阪府" } : null,
});

/** ブラウザから見た /api/me の応答（ログイン中のユーザー・環境）。そのほかの API は 404 として扱う */
function stubSession(me: Me | null, appMode: "general" | "demo" = "general") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return me ? json({ user: me, demoNow: null, appMode }, 200) : json({ error: "ログインしてください", demoNow: null, appMode }, 401);
    return json({ error: "not found" }, 404);
  }));
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

/** path を開き、ログイン状態の確認とリダイレクトが落ち着くまで待つ。最終的な URL と画面を返す */
async function open(path: string) {
  let current = "";
  function Probe() {
    current = useLocation().pathname;
    return null;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <SessionProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
          <Probe />
        </MemoryRouter>
      </SessionProvider>,
    );
  });
  for (let i = 0; i < 20 && container.querySelector("main[aria-busy]"); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const el = container;
  return {
    path: current,
    nav: el.querySelector(".bottom-nav"),
    tabs: [...el.querySelectorAll(".bottom-nav .nav-item")].map((a) => ({ label: a.querySelector(".nav-label")?.textContent, href: a.getAttribute("href"), current: a.getAttribute("aria-current") === "page" })),
    h1: el.querySelector("main h1")?.textContent ?? "",
    text: el.textContent ?? "",
  };
}

const PROTECTED = [
  "/restaurant/home", "/restaurant/buy", "/restaurant/consultations", "/restaurant/mypage",
  "/producer/home", "/producer/listings", "/producer/requests", "/producer/mypage",
  "/onboarding/restaurant", "/onboarding/producer/step-2",
];

describe("未ログイン", () => {
  it.each(PROTECTED)("%s → トップ（/）", async (path) => {
    stubSession(null);
    const r = await open(path);
    expect(r.path).toBe("/");
    expect(r.nav).toBeNull();
    expect(r.text).toContain("新規登録");
  });
  it("存在しない URL → トップ", async () => {
    stubSession(null);
    expect((await open("/no-such-page")).path).toBe("/");
  });
});

describe("初回登録がまだのユーザー（onboarded=false）", () => {
  it.each(["/", "/login", "/signup", "/demo", "/restaurant/home", "/restaurant/buy", "/producer/home", "/onboarding/producer"])(
    "飲食店が %s → /onboarding/restaurant/1", async (path) => {
      stubSession(restaurant(false));
      const r = await open(path);
      expect(r.path).toBe("/onboarding/restaurant/1");
      expect(r.h1).toBe("お店について教えてください");
    });
  it.each(["/", "/login", "/producer/home", "/producer/listings", "/restaurant/home", "/onboarding/restaurant/step-1"])(
    "生産者が %s → /onboarding/producer/1", async (path) => {
      stubSession(producer(false));
      const r = await open(path);
      expect(r.path).toBe("/onboarding/producer/1");
      expect(r.h1).toBe("農園について教えてください");
    });
  it("登録画面の STEP の URL はそのまま表示する（入力済みの STEP まで）", async () => {
    stubSession(restaurant(false));
    expect((await open("/onboarding/restaurant/1")).path).toBe("/onboarding/restaurant/1");
  });
  it("登録中は下部ナビを出さず、ログアウトだけ置く", async () => {
    for (const me of [restaurant(false), producer(false)]) {
      stubSession(me);
      const r = await open(`/onboarding/${me.role}`);
      expect(r.nav).toBeNull();
      expect(r.text).toContain("ログアウト");
      act(() => root?.unmount());
      container?.remove();
    }
  });
});

describe("登録済みのユーザー（onboarded=true）", () => {
  it("飲食店 → 飲食店のホーム", async () => {
    stubSession(restaurant(true));
    const r = await open("/");
    expect(r.path).toBe("/restaurant/home");
    expect(r.h1).toBe("テスト食堂");
  });
  it("生産者 → 生産者のホーム", async () => {
    stubSession(producer(true));
    const r = await open("/");
    expect(r.path).toBe("/producer/home");
    expect(r.h1).toBe("テスト農園");
  });
  it.each(["/producer/home", "/producer/listings", "/producer/requests", "/producer/mypage", "/producer"])(
    "飲食店が生産者の URL %s → 飲食店のホーム", async (path) => {
      stubSession(restaurant(true));
      expect((await open(path)).path).toBe("/restaurant/home");
    });
  it.each(["/restaurant/home", "/restaurant/buy", "/restaurant/consultations", "/restaurant/mypage", "/restaurant"])(
    "生産者が飲食店の URL %s → 生産者のホーム", async (path) => {
      stubSession(producer(true));
      expect((await open(path)).path).toBe("/producer/home");
    });
  it.each([
    ["general", "restaurant"], ["general", "producer"], ["demo", "restaurant"], ["demo", "producer"],
  ] as const)("%s mode の%sが /login /signup /demo / を開く → 自分のホーム", async (mode, role) => {
    for (const path of ["/login", "/signup", "/demo", "/"]) {
      stubSession(role === "restaurant" ? restaurant(true) : producer(true), mode);
      expect((await open(path)).path, path).toBe(`/${role}/home`);
      act(() => root?.unmount());
      container?.remove();
    }
  });
  it.each(["/onboarding/restaurant", "/onboarding/producer/step-1"])("登録画面 %s → 自分のホーム", async (path) => {
    stubSession(restaurant(true));
    expect((await open(path)).path).toBe("/restaurant/home");
  });
  it("自分のロールの存在しない URL → 自分のホーム", async () => {
    stubSession(producer(true));
    expect((await open("/producer/nothing")).path).toBe("/producer/home");
    act(() => root?.unmount());
    container?.remove();
    stubSession(producer(true));
    expect((await open("/elsewhere")).path).toBe("/producer/home");
  });
});

describe("ログイン後の共通の枠（4つのタブ）", () => {
  it("飲食店：ホーム・仕入れる・相談・マイページ。現在地は1つだけ", async () => {
    stubSession(restaurant(true));
    const r = await open("/restaurant/consultations");
    expect(r.path).toBe("/restaurant/consultations");
    expect(r.tabs.map((t) => t.label)).toEqual(["ホーム", "仕入れる", "相談", "マイページ"]);
    expect(r.tabs.map((t) => t.href)).toEqual(["/restaurant/home", "/restaurant/buy", "/restaurant/consultations", "/restaurant/mypage"]);
    expect(r.tabs.filter((t) => t.current).map((t) => t.label)).toEqual(["相談"]);
  });
  it("生産者：ホーム・出品・依頼・マイページ。現在地は1つだけ", async () => {
    stubSession(producer(true));
    const r = await open("/producer/requests");
    expect(r.path).toBe("/producer/requests");
    expect(r.tabs.map((t) => t.label)).toEqual(["ホーム", "出品", "依頼", "マイページ"]);
    expect(r.tabs.map((t) => t.href)).toEqual(["/producer/home", "/producer/listings", "/producer/requests", "/producer/mypage"]);
    expect(r.tabs.filter((t) => t.current).map((t) => t.label)).toEqual(["依頼"]);
  });
  it("タブはアイコンだけにせず、必ず文字を付ける", async () => {
    stubSession(producer(true));
    const r = await open("/producer/home");
    expect(r.tabs).toHaveLength(4);
    for (const t of r.tabs) expect(t.label?.trim().length).toBeGreaterThan(0);
  });
});
