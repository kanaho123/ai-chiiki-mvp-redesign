// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { ApiError, confirmationApi, ERROR_TEXT, friendlyError } from "../lib/confirmation-api";
import { hasUndecidedOperatorInfo, OPERATOR, PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import { appUrl, demoEntryUrl, generalHomeUrl } from "../routes/paths";
import { SessionProvider, type Me } from "../routes/session";

// 公開前の確認：利用規約・プライバシーポリシー、一般向け⇔デモの URL、エラーのときの表示。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let me: Me | null = null;
let mode: "general" | "demo" = "general";
let approvals: () => Response = () => json({ requests: [] });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
let meCalls = 0;
beforeEach(() => {
  me = null;
  mode = "general";
  meCalls = 0;
  approvals = () => json({ requests: [] });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/me")) { meCalls++; return me ? json({ user: me, demoNow: null, appMode: mode }) : json({ error: "ログインしてください", demoNow: null, appMode: mode }, 401); }
    if (url === "/api/approvals") return approvals();
    if (url === "/api/inbox") return json({ producerRequests: 0 });
    if (url === "/api/auth/demo-accounts") return json({ accounts: [] });
    return json({ error: "not found" }, 404);
  }));
});

let root: Root | null = null;
let el: HTMLDivElement;
let path = "";
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function open(at: string) {
  function Probe() { path = useLocation().pathname; return null; }
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => { root!.render(<SessionProvider><MemoryRouter initialEntries={[at]}><AppRoutes /><Probe /></MemoryRouter></SessionProvider>); });
  await flush();
}
const text = () => el.textContent ?? "";

describe("利用規約・プライバシーポリシー", () => {
  it("新規登録の画面から、両方の本文へのリンクがある（新しいタブ）", async () => {
    await open("/signup");
    const links = [...el.querySelectorAll<HTMLAnchorElement>(".legal-links a")].map((a) => [a.getAttribute("href"), a.target, a.rel]);
    expect(links).toEqual([["/terms", "_blank", "noopener"], ["/privacy", "_blank", "noopener"]]);
    // 同意のチェックとは別の場所にある（リンクを押してもチェックは変わらない）
    expect(el.querySelector(".check-row a")).toBeNull();
  });
  it.each([["/terms", "利用規約", TERMS_VERSION], ["/privacy", "プライバシーポリシー", PRIVACY_VERSION]])("%s：ログインしていなくても読める", async (at, title, version) => {
    await open(at);
    expect(path).toBe(at);
    expect(el.querySelector("main h1")?.textContent).toBe(title);
    expect(text()).toContain(version);
    expect(text()).toContain("公開前の案"); // 版が -draft の間
    expect(el.querySelector(".bottom-nav")).toBeNull();
  });
  it("ログイン中でも読める（ホームへ戻されない）", async () => {
    me = { id: "u", role: "restaurant", displayName: "店", producer: null, onboarded: true };
    await open("/privacy");
    expect(path).toBe("/privacy");
    expect(text()).toContain("アプリに戻る");
  });
  it("プライバシーポリシーは現在の実装の事実を書く（連絡先の表示・ログイン用メール・AI・パスワード）", async () => {
    await open("/privacy");
    const t = text();
    expect(t).toContain("その生産者が「対応できます」と返事をした相談の飲食店にだけ表示されます");
    expect(t).toContain("ログイン用のメールアドレスは、ほかの利用者には表示しません");
    expect(t).toContain("OpenAI");
    expect(t).toContain("store: false");
    expect(t).toContain("AI が取引や注文を決めることはありません");
    expect(t).toContain("ハッシュ");
    expect(t).toContain("仕入れ案の計算やおすすめには使っていません");
    expect(t).not.toMatch(/AIが(注文|取引)を(確定|決定)します/);
  });
  it("運営者の情報は推測で埋めず【未定：…】のまま表示する", async () => {
    await open("/terms");
    expect(text()).toContain(OPERATOR.name);
    expect(text()).toContain(OPERATOR.contact);
    expect(hasUndecidedOperatorInfo()).toBe(true); // 公開前に運営者が記入する（まだ決まっていない）
  });
  it("パスワードを忘れたとき：送信していないメールを送ったとは書かない", async () => {
    await open("/login");
    expect(text()).toContain("パスワードを設定し直す機能はありません");
    expect(text()).not.toMatch(/メールを送信しました|再設定用のメール/);
  });
});

describe("一般向け ⇔ デモの URL（環境変数で設定）", () => {
  it("https だけを使い、末尾の / をそろえる。開発中だけ localhost の http を許す", () => {
    expect(appUrl("https://demo.example.test/")).toBe("https://demo.example.test");
    expect(appUrl("https://demo.example.test/some/path")).toBe("https://demo.example.test");
    expect(appUrl("http://demo.example.test", false)).toBeNull();
    expect(appUrl("http://localhost:5182", false)).toBeNull();
    expect(appUrl("http://localhost:5182", true)).toBe("http://localhost:5182");
    expect(appUrl("https://localhost", false)).toBeNull();
    expect(appUrl("javascript:alert(1)", true)).toBeNull();
    expect(appUrl(undefined)).toBeNull();
    expect(appUrl("  ")).toBeNull();
    expect(demoEntryUrl("https://demo.example.test")).toBe("https://demo.example.test/demo");
    expect(demoEntryUrl(null)).toBeNull();
    expect(generalHomeUrl("https://app.example.test")).toBe("https://app.example.test/");
  });
  it("一般向け：トップの右上「デモを試す」はデモ用の環境の /demo へ", async () => {
    vi.stubEnv("VITE_DEMO_APP_URL", "https://demo.example.test/");
    await open("/");
    const a = [...el.querySelectorAll<HTMLAnchorElement>(".app-header a")].find((x) => x.textContent?.includes("デモを試す"));
    expect(a?.getAttribute("href")).toBe("https://demo.example.test/demo");
    expect([...el.querySelectorAll<HTMLAnchorElement>("main a")].find((x) => x.textContent?.includes("デモを試す"))?.getAttribute("href")).toBe("https://demo.example.test/demo");
  });
  it("URL が未設定ならデモへのリンクを出さない（localhost などを決め打ちしない）", async () => {
    vi.stubEnv("VITE_DEMO_APP_URL", "");
    await open("/");
    expect(text()).not.toContain("デモを試す");
    await act(async () => root!.unmount());
    root = null;
    el.remove();
    await open("/demo");
    expect(text()).toContain("デモの画面の場所が設定されていません");
  });
  it("デモ用の環境：一般向けのサービスへ戻るリンク（設定されているときだけ）。デモへのリンクは出さない", async () => {
    mode = "demo";
    vi.stubEnv("VITE_DEMO_APP_URL", "https://demo.example.test");
    vi.stubEnv("VITE_GENERAL_APP_URL", "https://app.example.test");
    await open("/demo");
    const links = [...el.querySelectorAll<HTMLAnchorElement>(".app-header a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["一般向けのサービスへ", "https://app.example.test/"]]);
  });
});

describe("エラーのときの表示（技術用語や HTTP の番号だけを出さない）", () => {
  beforeEach(() => { me = { id: "u", role: "restaurant", displayName: "まちの食堂", producer: null, onboarded: true }; });
  it("通信できない：日本語の説明と「もう一度読み込む」。押すと読み直して表示が戻る", async () => {
    let fail = true;
    approvals = () => { if (fail) throw new TypeError("Failed to fetch"); return json({ requests: [] }); };
    await open("/restaurant/home");
    expect(text()).toContain(ERROR_TEXT.network);
    expect(text()).not.toContain("Failed to fetch");
    fail = false;
    const retry = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("もう一度読み込む"))!;
    await act(async () => { retry.click(); });
    await flush();
    expect(text()).toContain("進行中の相談はありません");
    expect(el.querySelector(".error-retry")).toBeNull();
  });
  it("500 番台・JSON でない応答：共通の説明だけ（中身や番号は出さない）", async () => {
    approvals = () => new Response("<html>502 Bad Gateway</html>", { status: 502 });
    await open("/restaurant/consultations");
    expect(text()).toContain(ERROR_TEXT.server);
    expect(text()).not.toMatch(/502|Bad Gateway|<html>/);
  });
  it("ログインの有効期限切れ（401）：ログイン状態を確認し直し、トップへ戻す", async () => {
    approvals = () => { me = null; return json({ error: "ログインしてください" }, 401); };
    await open("/restaurant/home");
    await flush(8);
    expect(meCalls).toBeGreaterThanOrEqual(2);
    expect(path).toBe("/");
  });
});

describe("共通の API 関数", () => {
  const stub = (r: Response | Error) => vi.stubGlobal("fetch", vi.fn(async () => { if (r instanceof Error) throw r; return r; }));
  it("4xx はサーバーの日本語の説明、なければ共通の文。500 番台は共通の文", async () => {
    stub(json({ error: "この相談にはすでに返事をしています" }, 409));
    await expect(confirmationApi("/x")).rejects.toMatchObject({ message: "この相談にはすでに返事をしています", status: 409 });
    stub(json({}, 403));
    await expect(confirmationApi("/x")).rejects.toMatchObject({ message: ERROR_TEXT.other });
    stub(json({ error: "PrismaClientKnownRequestError" }, 500));
    await expect(confirmationApi("/x")).rejects.toMatchObject({ message: ERROR_TEXT.server });
    stub(new Response("not json", { status: 200 }));
    await expect(confirmationApi("/x")).rejects.toBeInstanceOf(ApiError);
  });
  it("ApiError 以外の例外は画面に出さない", () => {
    expect(friendlyError(new SyntaxError("Unexpected token <"), "読み込めませんでした")).toBe("読み込めませんでした");
    expect(friendlyError(new ApiError("説明", 400), "x")).toBe("説明");
  });
});
