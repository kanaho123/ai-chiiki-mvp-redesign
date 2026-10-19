// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../App";
import { ApiError, confirmationApi, ERROR_TEXT, friendlyError } from "../lib/confirmation-api";
import { hasUndecidedOperatorInfo, isDraftVersion, OPERATOR, PRIVACY_DATES, PRIVACY_HISTORY, PRIVACY_VERSION, TERMS_VERSION } from "../lib/legal";
import * as serverLegal from "../../server/legal";
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
    expect(text()).toContain("AI BOOTCAMP の最終課題として開発した、実証・試験運用の段階の Web サービス");
    expect(el.querySelector(".bottom-nav")).toBeNull();
  });
  it("利用規約：公開用の版・施行日のまま（プライバシーポリシーの改定の影響を受けない）", async () => {
    await open("/terms");
    expect(text()).toContain(`版：2026-10-18・施行日：${OPERATOR.effectiveDate}`);
    expect(text()).not.toContain("公開前の案");
    expect(text()).not.toContain("改定");
  });
  it("プライバシーポリシー：専用の版・制定日・最終改定日・改定履歴を出す。dev の間は公開前の案と分かる", async () => {
    await open("/privacy");
    expect(text()).toContain(`版：${PRIVACY_VERSION}・制定：${PRIVACY_DATES.established}・最終改定：${PRIVACY_DATES.lastRevised}`);
    expect(text()).not.toContain("施行日");
    expect([...el.querySelectorAll(".legal-dates div")].map((d) => d.textContent)).toEqual([`制定日${PRIVACY_DATES.established}`, `最終改定日${PRIVACY_DATES.lastRevised}（公開前の案）`]);
    expect([...el.querySelectorAll(".legal-history li")].map((li) => li.textContent)).toEqual(PRIVACY_HISTORY.map((h) => `${h.date}　${h.text}`));
    expect(el.querySelector(".alert.warn")?.textContent).toContain("これは公開前の案です");
    expect(text()).toContain("変更内容は、本サービス上の本ポリシーの改定日・改定履歴等でお知らせします");
    expect(text()).not.toContain("変更するときは、本サービス上でお知らせします");
  });
  it("プライバシーポリシー：受け渡し場所の取り扱いを、今の実装のとおりに書く（住所の表示範囲）", async () => {
    await open("/privacy");
    const t = text();
    expect(t).toContain("場所の名前、住所、場所の種類（直売所・集荷場・出荷先・自分の農園・その他）、渡せる曜日と時間帯");
    expect(t).not.toContain("参加する受渡枠");
    expect(t).not.toContain("メモ");
    expect(t).toContain("品目・品種・規格と規格外の理由・産地・数量・最低販売量・価格・受け渡しの場所と日時・公開の状態");
    expect(t).toContain("生産者の受け渡し場所の登録と、仕入れ案での受け取りの場所と日時の提案");
    expect(t).toContain("生産者が登録した受け渡し場所の住所は、飲食店には表示しません");
    expect(t).toContain("飲食店が入力した文章と受け取りの場所を照合するときにも、その住所は使いません");
    expect(t).toContain("候補の段階では住所を表示しません");
    expect(t).toContain("ほかの生産者がその場所を自分の受け渡し場所として選んだ場合は、その生産者に住所が表示されます");
    expect(t).toContain("種類が「自分の農園」「その他」の場所は、ほかの生産者の候補には表示しません");
    expect(t).toContain("登録した受け渡し場所は、現在アプリ内で変更・削除できません");
    expect(t).not.toMatch(/住所は(ほかの利用者に)?公開されます|必ず|絶対に|完全に/);
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
    expect(t).toContain("本サービスの提供・運営に必要な期間保存します");
    expect(t).toContain("アプリ内から利用者自身で退会・削除する機能はありません");
    expect(t).not.toContain("アカウントを削除するまで保存します");
    expect(t).not.toMatch(/AIが(注文|取引)を(確定|決定)します/);
  });
  it("利用規約の料金：現在無料・決済機能なし・受渡料金は受渡条件として表示し請求しない", async () => {
    await open("/terms");
    const t = text();
    expect(t).toContain("本サービスの利用料金は現在無料です");
    expect(t).toContain("本サービス上に決済機能はありません");
    expect(t).toContain("受渡枠に表示される料金は受渡条件として表示するもので、本サービスから利用者へ請求・決済を行うものではありません");
    expect(t).toContain("実際の取引に伴う費用については、当事者間でご確認ください");
    expect(t).not.toContain("管轄");
  });
  it("運営者の情報は確定したものを表示し、【未定】の表記は公開画面に残さない", async () => {
    expect(OPERATOR).toEqual({ name: "beyond the past", contact: "ka77o@icloud.com", effectiveDate: "2026年10月18日" });
    expect(hasUndecidedOperatorInfo()).toBe(false);
    for (const at of ["/terms", "/privacy", "/login", "/signup"]) {
      await open(at);
      expect(text(), at).not.toMatch(/未定|【/);
      expect(text(), at).not.toMatch(/専門家(の|による)?確認(済み|を受けた)|法的に(完全|問題ない)/);
      if (at !== "/signup") {
        expect(text(), at).toContain(OPERATOR.contact);
        expect(el.querySelector(`a[href="mailto:${OPERATOR.contact}"]`), at).not.toBeNull();
      }
      if (at === "/terms" || at === "/privacy") expect(text()).toContain(OPERATOR.name);
      act(() => root?.unmount());
      root = null;
      el.remove();
    }
  });
  it("規約の版：新規登録の同意として記録する版（サーバー）と同じ。プライバシーポリシーは dev の間は公開前の案", () => {
    expect(TERMS_VERSION).toBe("2026-10-18");
    expect(isDraftVersion(TERMS_VERSION)).toBe(false);
    // Production に反映する日に、正式な版（"-draft" なし）・改定日に変え、このテストも公開用の版を確かめる形に戻す
    expect(PRIVACY_VERSION).toBe("2026-10-19-draft");
    expect(isDraftVersion(PRIVACY_VERSION)).toBe(true);
    expect(serverLegal.TERMS_VERSION).toBe(TERMS_VERSION);
    expect(serverLegal.PRIVACY_VERSION).toBe(PRIVACY_VERSION);
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
