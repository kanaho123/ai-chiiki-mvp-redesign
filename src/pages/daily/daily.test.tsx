// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { AppRoutes } from "../../App";
import type { Confirmation, ConfirmationStatus } from "../../lib/approvals";
import { SessionProvider, type Me } from "../../routes/session";

// 日常の画面（ホーム・相談・依頼・マイページ・下部ナビの数）のテスト。ブラウザから見た API の応答だけを差し替える。
// サーバー側の権限・連絡先の開示の制御は server/*.test.ts で本物の処理を使って確かめている。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const restaurant: Me = { id: "u-r", role: "restaurant", displayName: "まちの食堂", producer: null, onboarded: true };
const producer: Me = { id: "u-p", role: "producer", displayName: "みどり農園", producer: { id: "p-1", farmName: "みどり農園", originPrefecture: "大阪府" }, onboarded: true };
const req = (id: string, status: ConfirmationStatus, over: Partial<Confirmation> = {}): Confirmation => ({
  id, supplyId: `s-${id}`, producerName: "A農園", restaurantName: "まちの食堂", planFingerprint: "fp-1", itemName: "トマト", quantityKg: 5,
  priceYenPerKg: 600, subtotalYen: 3000, pickupStartAt: "2026-10-23T01:00:00.000Z", pickupEndAt: "2026-10-23T02:00:00.000Z",
  pickupPlace: "梅田エリア受渡所（仮）", status, createdAt: "2026-10-20T00:00:00.000Z", ...over,
});

let me: Me;
let requests: Confirmation[] = [];
let profile: Record<string, unknown> | null = null;
let calls: { url: string; method: string; body?: unknown }[] = [];
let mode: "general" | "demo" = "general";
let contact = { contactPhone: "000-0000-0001" as string | null, contactEmail: "a-farm@example.invalid" as string | null };
const supplyRow = (over: Record<string, unknown> = {}) => ({
  id: "sp1", item: { name: "トマト" }, variety: { name: "指定なし" }, grade: "regular", availableKg: 8, priceYenPerKg: 600, published: true,
  updatedAt: "2026-10-20T03:00:00.000Z", slot: { label: "梅田・火", placeName: "梅田", startAt: "2026-10-27T01:00:00.000Z", endAt: "2026-10-27T02:00:00.000Z" }, ...over,
});
let supplyRows: ReturnType<typeof supplyRow>[] = [];
type SlotMock = { id: string; label: string; placeId?: string; placeName: string; startAt: string; endAt: string; participationConfirmed?: boolean };
const umedaSlot: SlotMock = { id: "sl1", label: "梅田・火", placeId: "pl-umeda", placeName: "梅田エリア受渡所（仮）", startAt: "2099-10-27T01:00:00.000Z", endAt: "2099-10-27T02:00:00.000Z", participationConfirmed: true };
let slots: SlotMock[] = [];
type Json = (b: unknown, status?: number) => Response;
// 出品の登録（POST /api/supplies）の応答。テストごとに差し替える
const defaultSupplyPost = (b: Record<string, unknown>, json: Json) => json({ supply: { item: { name: (b.itemName as string) ?? ({ "i-tomato": "トマト", "i-nasu": "なす" } as Record<string, string>)[b.itemId as string] }, availableKg: Number(b.availableKg) } }, 201);
let supplyPost: (b: Record<string, unknown>, json: Json) => Response = defaultSupplyPost;
/** 出品の下書き（/api/supply-draft）の応答。null なら AI が使えない（503） */
let draftReply: Record<string, unknown> | null = null;
const usualUmeda = { placeId: "pl-umeda", name: "梅田エリア受渡所（仮）", address: "大阪市北区", kind: null, times: [{ seriesId: "s-umeda", weekday: 2, startTime: "10:00", endTime: "11:00", active: true }] };
// 取引のやり取り（相談の id ごと）と受け取り完了
let tradeMessages: Record<string, { id: string; body: string; createdAt: string; mine: boolean; sender: string; senderName: string }[]> = {};
// 取引後の評価・いつもの農家（相談の id ごと）
let reviewState: Record<string, { review: { rating: string; comment: string | null; createdAt: string } | null; usual: boolean | null }> = {};
let pickup: { usual: unknown[]; candidates: { placeId: string; name: string; address: string; kind: string | null }[] } = { usual: [], candidates: [] };
beforeEach(() => {
  tradeMessages = {};
  reviewState = {};
  supplyPost = defaultSupplyPost;
  draftReply = null;
  supplyRows = [supplyRow()];
  slots = [umedaSlot];
  pickup = {
    usual: [usualUmeda],
    candidates: [
      { placeId: "pl-umeda", name: "梅田エリア受渡所（仮）", address: "大阪市北区", kind: null },
      { placeId: "pl-store", name: "南区ふれあい直売所", address: "", kind: "direct_store" }, // ほかの生産者が登録した場所：住所は来ない
    ],
  };
  mode = "general";
  contact = { contactPhone: "000-0000-0001", contactEmail: "a-farm@example.invalid" };
  requests = [];
  profile = null;
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ user: me, demoNow: null, appMode: mode });
    if (url === "/api/approvals?view=contact") return json({ contact });
    if (url === "/api/approvals" && method === "PATCH") {
      const b = body as { contactPhone: string; contactEmail: string };
      if (!b.contactPhone && !b.contactEmail) return json({ error: "電話番号かメールアドレスを1つ登録してください" }, 400);
      contact = { contactPhone: b.contactPhone || null, contactEmail: b.contactEmail || null };
      return json({ contact });
    }
    if (url === "/api/inbox") return json({ producerRequests: me.role === "producer" ? requests.filter((r) => r.status === "pending").length : 0 });
    if (url === "/api/approvals" && method === "GET") return json({ requests });
    const thread = /^\/api\/approvals\/([^/]+)\/messages$/.exec(url);
    if (thread) {
      const id = decodeURIComponent(thread[1]);
      const list = (tradeMessages[id] ??= []);
      if (method === "POST") {
        const m = { id: `m${list.length + 1}`, body: (body as { body: string }).body, createdAt: "2026-10-22T03:00:00.000Z", mine: true, sender: me.role, senderName: "まちの食堂" };
        list.push(m);
        return json({ message: m }, 201);
      }
      return json({ messages: list, completed: requests.some((r) => r.id === id && r.receivedAt) });
    }
    const after = /^\/api\/approvals\/([^/]+)\/(review|usual)$/.exec(url);
    if (after) {
      const st = (reviewState[decodeURIComponent(after[1])] ??= { review: null, usual: me.role === "restaurant" ? false : null });
      if (after[2] === "usual") { st.usual = true; return json({ usual: true }); }
      if (method === "POST") {
        if (st.review) return json({ error: "この取引はすでに評価しています" }, 409);
        const b = body as { rating: string; comment: string };
        st.review = { rating: b.rating, comment: b.comment || null, createdAt: "2026-10-22T06:00:00.000Z" };
        return json({ review: st.review }, 201);
      }
      return json(st);
    }
    if (url === "/api/approvals/received" && method === "POST") {
      const fp = (body as { fingerprint: string }).fingerprint;
      for (const r of requests) if (r.planFingerprint === fp && r.status === "approved") r.receivedAt ??= "2026-10-22T05:00:00.000Z";
      return json({ requests });
    }
    const one = /^\/api\/approvals\/(.+)$/.exec(url);
    if (one && method === "PATCH") {
      const r = requests.find((x) => x.id === decodeURIComponent(one[1]))!;
      r.status = (body as { status: ConfirmationStatus }).status;
      return json({ request: r });
    }
    if (one) {
      const r = requests.find((x) => x.id === decodeURIComponent(one[1]));
      return r?.status === "approved" ? json({ contact: { contactPhone: "000-0000-0001", contactEmail: "a-farm@example.invalid" } }) : json({ error: "まだ連絡先は見られません" }, 403);
    }
    if (url === "/api/supplies" && method === "POST") return supplyPost(body as Record<string, unknown>, json);
    if (url === "/api/supply-draft" && method === "POST") return draftReply ? json({ draft: draftReply }) : json({ error: "AIで読み取れませんでした。手で入力してください" }, 503);
    if (url === "/api/supplies") return json({ supplies: supplyRows, slots, items: [{ id: "i-tomato", name: "トマト", varieties: [{ id: "v-tomato", name: "指定なし" }] }, { id: "i-nasu", name: "なす", varieties: [{ id: "v-nasu", name: "指定なし" }] }], prefectures: ["大阪府", "京都府", "東京都"], places: mode === "general" ? pickup.usual : null });
    if (url === "/api/pickup-points" && method === "GET") return json({ points: [], ...pickup });
    if (url === "/api/pickup-points" && method === "POST") {
      // 場所だけを登録する（曜日・時間は持たない。受渡の回は出品のときに作る）
      const b = body as { placeId?: string; name?: string; address?: string };
      const cand = b.placeId ? pickup.candidates.find((c) => c.placeId === b.placeId)! : null;
      const added = { placeId: b.placeId ?? "pl-new", name: cand?.name ?? b.name!, address: cand?.address ?? b.address ?? "", kind: null, times: [] };
      pickup = { ...pickup, usual: [...pickup.usual, added] };
      return json({ created: {}, points: [], usual: pickup.usual }, 201);
    }
    if (url === "/api/profile" && method === "GET") return profile ? json(profile) : json({ error: "なし" }, 404);
    if (url === "/api/profile" && method === "PATCH") {
      profile = { ...profile!, profile: body };
      return json({ ...profile, user: me });
    }
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
const $ = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel);
const text = () => el.textContent ?? "";
const click = async (node: Element | null | undefined) => { expect(node).toBeTruthy(); await act(async () => { (node as HTMLElement).click(); }); await flush(); };
const button = (label: string) => [...el.querySelectorAll("button, a")].find((b) => b.textContent?.trim().includes(label));
const badge = () => $(".bottom-nav .nav-badge")?.textContent ?? null;

describe("飲食店のホーム", () => {
  beforeEach(() => { me = restaurant; });
  it("相談なし：「AIに仕入れを相談する」が見出しのすぐ下の唯一の主ボタン。「進行中の相談はありません」", async () => {
    await open("/restaurant/home");
    expect($("main h1")?.textContent).toBe("まちの食堂");
    expect(text()).toContain("進行中の相談はありません");
    expect($(".todo")).toBeNull(); // 「仕入れ案をつくりましょう」は主ボタンと同じ案内なので出さない
    expect(el.querySelectorAll("main .btn-primary")).toHaveLength(1);
    const main = $<HTMLAnchorElement>("main .btn-primary")!;
    expect(main.textContent).toContain("AIに仕入れを相談する");
    expect(main.getAttribute("href")).toBe("/restaurant/buy");
    expect(main.compareDocumentPosition($("#ongoing-title")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("返事待ち：「トマト 10kg」と農家ごとの状態をふつうの言葉で", async () => {
    requests = [req("a", "pending"), req("b", "pending", { producerName: "B農園" })];
    await open("/restaurant/home");
    expect($(".consult-title")?.textContent).toBe("トマト 10kg");
    expect([...el.querySelectorAll(".farm-line")].map((x) => x.textContent)).toEqual(["A農園：返事待ち", "B農園：返事待ち"]);
    expect($(".consult-card .state-tag")?.textContent).toBe("返事待ち");
    expect($(".todo-text")?.textContent).toContain("返事を待っています");
  });
  it("全農家が対応できる：「今やること」は短く「マッチ成立：生産者とやり取りできます」", async () => {
    requests = [req("a", "approved"), req("b", "approved", { producerName: "B農園" })];
    await open("/restaurant/home");
    expect($(".consult-card .state-tag")?.textContent).toBe("マッチ成立");
    expect($(".todo-text")?.textContent).toBe("マッチ成立：生産者とやり取りできます");
  });
  it("一部の農家だけ対応できる：成立とは言わず、農家ごとの状態とほかの農家の返事待ち", async () => {
    requests = [req("a", "approved"), req("b", "pending", { producerName: "B農園" })];
    await open("/restaurant/home");
    expect($(".consult-card .state-tag")?.textContent).toBe("返事待ち");
    expect($(".consult-card .consult-next")?.textContent).toBe("生産者回答待ち（1/2農家が回答済み）");
    expect([...el.querySelectorAll(".farm-line")].map((x) => x.textContent)).toEqual(["A農園：対応できます", "B農園：返事待ち"]);
    expect($(".todo-text")?.textContent).toBe("A農園が「対応できます」と返事をしました。ほかの農家の返事を待っています");
    expect(text()).not.toMatch(/マッチ成立|一部成立/);
  });
  it("一部対応できない：相談の状態と農家ごとの状態", async () => {
    requests = [req("a", "approved"), req("b", "rejected", { producerName: "B農園" })];
    await open("/restaurant/home");
    expect($(".consult-card .state-tag")?.textContent).toBe("一部対応できません");
    expect([...el.querySelectorAll(".farm-line")].map((x) => x.textContent)).toEqual(["A農園：対応できます", "B農園：今回は対応できません"]);
    expect(text()).not.toMatch(/承認|NG/);
  });
  it("飲食店の「相談」には件数のバッジを出さない", async () => {
    requests = [req("a", "approved")];
    await open("/restaurant/home");
    expect(badge()).toBeNull();
  });
});

describe("飲食店の相談一覧・詳細", () => {
  beforeEach(() => { me = restaurant; });
  it("相談を仕入れ案ごとにまとめ、詳細では対応できる農家だけ連絡先を見られる", async () => {
    requests = [
      req("a", "approved"), req("b", "pending", { producerName: "B農園" }),
      req("c", "rejected", { planFingerprint: "fp-old", itemName: "なす", createdAt: "2026-10-01T00:00:00.000Z" }),
    ];
    await open("/restaurant/consultations");
    expect(text()).toContain("進行中（1件）");
    expect(text()).toContain("終わった相談（1件）");
    await click(el.querySelector('a.consult-card[href="/restaurant/consultations/fp-1"]'));
    expect(path).toBe("/restaurant/consultations/fp-1");
    expect($("main h1")?.textContent).toBe("トマト 10kg");
    const rows = [...el.querySelectorAll(".farm-row")];
    expect(rows.map((r) => r.querySelector(".state-tag")?.textContent)).toEqual(["対応できます", "返事待ち"]);
    expect(rows[0].textContent).toContain("連絡先を見る");
    expect(rows[1].textContent).not.toContain("連絡先を見る");
    expect(calls.some((c) => /^\/api\/approvals\/./.test(c.url))).toBe(false); // 押すまでは連絡先を取りに行かない
    await click(rows[0].querySelector("button"));
    expect($(".contact-details")?.textContent).toContain("000-0000-0001");
    expect($(".contact-details a[href='tel:00000000001']")).not.toBeNull();
    expect(calls.filter((c) => /^\/api\/approvals\/./.test(c.url)).map((c) => c.url)).toEqual(["/api/approvals/a"]);
    expect(el.querySelector('.bottom-nav a[aria-current="page"]')?.textContent).toContain("相談");
  });
  it("詳細：全農家が対応できる相談（2農家）は「マッチ成立」と「生産者とのやり取り」：農家ごとに「トークする」。電話・メールは「連絡先を見る」を押したときだけ", async () => {
    requests = [req("a", "approved"), req("b", "approved", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($("main .state-tag")?.textContent).toBe("マッチ成立");
    expect($("main h1")?.textContent).toBe("トマト 10kg");
    expect($(".consult-place")?.textContent).toBe("受け取り：梅田エリア受渡所（仮）");
    // 進み具合：相談送信済み・生産者回答待ち・マッチ成立は済み、いまは受け渡し待ち
    expect([...el.querySelectorAll(".progress-step")].map((s) => `${s.querySelector(".progress-label")?.textContent}:${s.className.replace("progress-step ", "")}`))
      .toEqual(["相談送信済み:done", "生産者回答待ち:done", "マッチ成立:done", "受け渡し待ち:current"]);
    expect($(".progress-current")?.textContent).toBe("いま：受け渡し待ち");
    // 狭い画面でも単語の途中で折り返さない区切り
    expect([...el.querySelectorAll(".progress-step .progress-label")].map((l) => [...l.querySelectorAll(".progress-label-part")].map((p) => p.textContent)))
      .toEqual([["相談", "送信済み"], ["生産者", "回答待ち"], ["マッチ", "成立"], ["受け渡し", "待ち"]]);
    // 農家ごと：数量・金額と「トークする」（主）・「連絡先を見る」（補助）。長い説明・成立の重複表示は出さない
    expect($("#talk-title")?.textContent).toBe("生産者とのやり取り");
    const rows = [...el.querySelectorAll(".talk-row")];
    expect(rows.map((r) => r.querySelector(".talk-head")?.textContent)).toEqual(["A農園5kg・¥3,000", "B農園5kg・¥3,000"]);
    expect(rows.map((r) => r.querySelector(".btn-primary")?.textContent)).toEqual(["トークする", "トークする"]);
    expect(rows.map((r) => r.querySelector(".talk-contact")?.textContent)).toEqual(["連絡先を見る", "連絡先を見る"]);
    expect($(".match-banner")).toBeNull();
    expect(text()).not.toMatch(/注文の?確定|直接相談|取引相談へ進む|そろいました/);
    expect($(".consult-total")?.textContent).toBe("商品代の合計 ¥6,000（税込・受け渡し費用は別）");
    // 押すまでは連絡先もやり取りも取りに行かない・電話番号は見えない
    expect(text()).not.toContain("000-0000-0001");
    expect($(".trade-chat")).toBeNull();
    expect(calls.some((c) => /^\/api\/approvals\/./.test(c.url))).toBe(false);
    await click(rows[0].querySelector(".talk-contact"));
    expect(rows[0].querySelector(".contact-details a[href='tel:00000000001']")?.textContent).toBe("電話：000-0000-0001");
    expect(rows[0].querySelector(".contact-details")?.textContent).toContain("メール：a-farm@example.invalid");
    expect(rows[1].querySelector(".contact-details")).toBeNull();
    expect(calls.filter((c) => /^\/api\/approvals\/./.test(c.url)).map((c) => c.url)).toEqual(["/api/approvals/a"]);
  });
  it("詳細：3農家で成立：A・B・C それぞれに「トークする」。開いたトークはその農家との1対1だけ", async () => {
    requests = [
      req("a", "approved", { quantityKg: 5, subtotalYen: 3000 }),
      req("b", "approved", { producerName: "B農園", quantityKg: 3, subtotalYen: 1650 }),
      req("c", "approved", { producerName: "C農園", quantityKg: 2, subtotalYen: 1000 }),
    ];
    await open("/restaurant/consultations/fp-1");
    const rows = () => [...el.querySelectorAll(".talk-row")];
    expect(rows().map((r) => r.querySelector(".talk-head")?.textContent)).toEqual(["A農園5kg・¥3,000", "B農園3kg・¥1,650", "C農園2kg・¥1,000"]);
    expect(rows().map((r) => r.querySelector(".btn-primary")?.textContent)).toEqual(["トークする", "トークする", "トークする"]);
    await click(rows()[1].querySelector(".talk-open"));
    expect(el.querySelectorAll(".trade-chat")).toHaveLength(1);
    expect(rows()[1].querySelector(".trade-chat")?.getAttribute("aria-label")).toBe("B農園とのやり取り");
    expect(calls.filter((c) => c.url.endsWith("/messages")).map((c) => c.url)).toEqual(["/api/approvals/b/messages"]);
    expect(rows()[1].querySelector(".talk-close")?.textContent).toBe("トークを閉じる");
    expect($(".consult-total")?.textContent).toBe("商品代の合計 ¥5,650（税込・受け渡し費用は別）");
  });
  it("詳細：一部の農家だけ対応できる相談にはマッチ成立もトークも出さない。進み具合は「1/2農家が回答済み」と短く", async () => {
    requests = [req("a", "approved"), req("b", "pending", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($(".match-banner")).toBeNull();
    expect($("main .state-tag")?.textContent).toBe("返事待ち");
    expect([...el.querySelectorAll(".progress-step")].map((s) => s.className.replace("progress-step ", ""))).toEqual(["done", "current"]); // まだ先の段階（マッチ成立・受け渡し待ち）は出さない
    expect($(".progress-current")?.textContent).toBe("いま：生産者回答待ち（1/2農家が回答済み）");
    expect(text()).not.toMatch(/マッチ成立|一部成立|🎉/);
    expect(text()).not.toMatch(/注文の?確定|直接相談/); // 長い説明文は出さない
    expect($(".talk-row")).toBeNull();
    expect(button("トークする")).toBeUndefined();
    expect(text()).not.toMatch(/数量・受け?取/);
  });
  it("詳細：在庫が変わった相談は、もう一度の確認を案内する（マッチ成立は出さない）", async () => {
    requests = [req("a", "approved"), req("b", "stale", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($(".match-banner")).toBeNull();
    expect($("main .alert.warn")?.textContent).toBe("在庫や条件が変わったため、現在の条件でもう一度確認が必要です。仕入れ案を計算し直して、改めて相談してください。");
  });
  it("相談がなければ案内と主ボタン", async () => {
    await open("/restaurant/consultations");
    expect(text()).toContain("まだ相談はありません");
    expect($("main .btn-primary")?.textContent).toBe("AIに仕入れを相談する");
  });
});

describe("生産者のホームと下部ナビの数", () => {
  beforeEach(() => { me = producer; });
  it("未対応 0：知らせもバッジも出さない。主ボタンは見出しのすぐ下の「農産物を出品する」だけ", async () => {
    requests = [req("a", "approved")];
    await open("/producer/home");
    expect($(".new-requests")).toBeNull();
    expect(badge()).toBeNull();
    expect(el.querySelectorAll("main .btn-primary")).toHaveLength(1);
    expect($("main .btn-primary")?.textContent).toContain("農産物を出品する");
    expect($("main .btn-primary")?.getAttribute("href")).toBe("/producer/listings/new");
    expect(text()).toContain("いま返事が必要な相談はありません");
    expect(text()).toContain("トマト");
    expect(text()).toContain("8kg");
    expect($(".next-slot")?.textContent).toContain("梅田エリア受渡所（仮）");
  });
  it("未対応 1：出品ボタンのすぐ下に「あなたの出品条件に合う仕入れ相談が1件あります」・バッジ 1・相談への返事へのボタン", async () => {
    requests = [req("a", "pending")];
    await open("/producer/home");
    const notice = $(".new-requests")!;
    expect(notice.textContent).toContain("あなたの出品条件に合う仕入れ相談が1件あります");
    expect(text()).toContain("飲食店からの仕入れ相談");
    // 主ボタン（出品）の次に相談（出品・受渡枠より前）
    const order = [...el.querySelectorAll("main .btn-primary, main .new-requests, main #listing-title, main #slot-title")].map((x) => x.id || x.className.split(" ").find((c) => c === "btn-primary" || c === "new-requests"));
    expect(order.slice(0, 2)).toEqual(["btn-primary", "new-requests"]);
    expect(badge()).toBe("1");
    expect($(".bottom-nav .sr-only")?.textContent).toContain("未対応 1件");
    expect($("main .btn-primary")?.textContent).toContain("農産物を出品する");
    expect(button("相談に返事をする")?.getAttribute("href")).toBe("/producer/requests");
  });
  it("未対応が複数：件数とバッジ", async () => {
    requests = [req("a", "pending"), req("b", "pending", { restaurantName: "別の店" }), req("c", "pending"), req("d", "rejected"), req("e", "stale")];
    await open("/producer/home");
    expect($(".new-requests")?.textContent).toContain("あなたの出品条件に合う仕入れ相談が3件あります");
    expect(badge()).toBe("3");
  });
});

describe("生産者の「依頼」", () => {
  beforeEach(() => { me = producer; });
  it("未対応を先に、ふつうの言葉のボタンで返事。返事のあとは対応済に移り、バッジも減る", async () => {
    requests = [req("a", "pending"), req("b", "approved", { restaurantName: "別の店" }), req("c", "rejected"), req("d", "stale")];
    await open("/producer/requests");
    const titles = [...el.querySelectorAll("main .section-title")].map((t) => t.textContent);
    expect(titles).toEqual(["未対応（1件）", "対応済（1件）", "今回は難しい（1件）"]);
    expect(text()).toContain("条件が変わって終わった相談（1件）");
    expect(button("対応できます")).toBeTruthy();
    expect(button("今回は対応できません")).toBeTruthy();
    expect(text()).not.toMatch(/承認|NG|Reject/);
    expect(badge()).toBe("1");
    const inboxBefore = calls.filter((c) => c.url === "/api/inbox").length;
    await click(el.querySelector(".request-actions .btn-primary"));
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/approvals/a", body: { status: "approved" } });
    expect($("main .alert.ok")?.textContent).toBe("まちの食堂の仕入れ相談に「対応できます」と回答しました。まちの食堂に、あなたの連絡先が表示されます。注文の確定や在庫の確保にはなりません。");
    expect(text()).not.toContain("成立");
    expect([...el.querySelectorAll("main .section-title")].map((t) => t.textContent)).toEqual(["未対応（0件）", "対応済（2件）", "今回は難しい（1件）"]);
    expect(calls.filter((c) => c.url === "/api/inbox").length).toBeGreaterThan(inboxBefore);
    expect(badge()).toBeNull();
  });
  it("相談カード：飲食店の必要量・希望日・規格外や初めての農家の可否など、保存済みの条件を出す", async () => {
    requests = [req("a", "pending", { conditions: { requestedKg: 10, desiredDate: "2026-10-23", originPrefectures: ["大阪府"], allowIrregular: true, allowFirstTime: true, allowMixedVarieties: false, allowMixedGrades: false } })];
    await open("/producer/requests");
    const card = $(".request-list .farm-row")!;
    expect(card.textContent).toContain("まちの食堂");
    expect(card.querySelector(".request-what")?.textContent).toBe("トマト 5kg");
    expect(card.textContent).toContain("飲食店が必要な量 10kg のうち、あなたへの相談は 5kg");
    expect(card.textContent).toContain("希望日：10月23日（金）");
    expect([...card.querySelectorAll(".request-conds li")].map((li) => li.textContent)).toEqual(["規格外可", "初めての農家可", "産地大阪府"]); // 品種・規格の「まぜ」は飲食店が選ぶ条件ではないので出さない
    expect(text()).not.toMatch(/予算|budget/);
  });
  it("相談カード：条件を読めない古い相談でも、これまでどおりの内容で表示する", async () => {
    requests = [req("a", "pending", { conditions: null })];
    await open("/producer/requests");
    expect($(".request-list .farm-row .request-what")?.textContent).toBe("トマト 5kg");
    expect($(".request-conds")).toBeNull();
    expect(text()).not.toContain("希望日");
  });
  it("「今回は対応できません」も返事できる", async () => {
    requests = [req("a", "pending")];
    await open("/producer/requests");
    await click(button("今回は対応できません"));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "rejected" });
    expect($("main .alert.ok")?.textContent).toBe("まちの食堂の仕入れ相談に「今回は対応できません」と回答しました。");
    expect(text()).toContain("今回は難しい（1件）");
  });
});

describe("取引：成立後のやり取り・受け取り完了（相談の詳細＝取引ページ）", () => {
  const typeInto = async (input: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  it("飲食店：成立した1農家の取引でやり取り → 「受け取り完了」（確認つき・仕入れ案ごとに1回）→ 「取引が完了しました」", async () => {
    me = restaurant;
    requests = [req("a", "approved", { established: true, receivedAt: null })];
    await open("/restaurant/consultations/fp-1");
    expect($("main .state-tag")?.textContent).toBe("マッチ成立");
    expect($(".trade-chat")).toBeNull(); // 「トークする」で開く
    await click(button("トークする"));
    const chat = $(".trade-chat")!;
    expect(chat.getAttribute("aria-label")).toBe("A農園とのやり取り");
    expect(chat.closest(".talk-row")?.querySelector(".talk-head b")?.textContent).toBe("A農園");
    expect(chat.textContent).toContain("まだメッセージはありません");
    await typeInto(chat.querySelector("textarea")!, "当日はよろしくお願いします");
    await click(chat.querySelector("button[type=submit]"));
    expect(calls.find((c) => c.url === "/api/approvals/a/messages" && c.method === "POST")?.body).toEqual({ body: "当日はよろしくお願いします" });
    expect([...el.querySelectorAll(".trade-message .trade-body")].map((b) => b.textContent)).toEqual(["当日はよろしくお願いします"]);
    expect($(".trade-message.mine .trade-meta b")?.textContent).toBe("あなた");
    // 受け取り完了：確認のあと1回だけ
    await click(button("受け取り完了"));
    expect($(".receive-confirm")?.textContent).toContain("商品を実際に受け取りましたか？完了するとこの取引は完了済みになります。");
    expect(calls.some((c) => c.url === "/api/approvals/received")).toBe(false);
    await click(button("受け取り完了にする"));
    expect(calls.filter((c) => c.url === "/api/approvals/received").map((c) => c.body)).toEqual([{ fingerprint: "fp-1" }]);
    expect($(".trade-done-title")?.textContent).toBe("取引が完了しました");
    expect([...el.querySelectorAll(".trade-done-facts div")].map((d) => d.textContent)).toEqual([
      "品目トマト", "合計数量5kg", "生産者A農園", "受け取り場所梅田エリア受渡所（仮）", `受け取り日時${$(".consult-when")!.textContent!.split("・")[0]}`,
    ]);
    expect($("main .state-tag")?.textContent).toBe("取引完了");
    expect($(".match-banner")).toBeNull();
    expect($(".receive-box")).toBeNull();
    expect([...el.querySelectorAll(".progress-step")].map((x) => `${x.querySelector(".progress-label")?.textContent}:${x.className.replace("progress-step ", "")}`))
      .toEqual(["相談送信済み:done", "生産者回答待ち:done", "マッチ成立:done", "受け渡し待ち:done", "取引完了:done"]);
    expect($(".trade-chat textarea")).toBeNull(); // 完了後は読むだけ
    expect($(".trade-chat")?.textContent).toContain("この取引は完了しています");
  });
  it("飲食店：成立前（返事待ち）はやり取りも受け取り完了も出さない。1農家が対応できないときは作り直しの案内", async () => {
    me = restaurant;
    requests = [req("a", "approved"), req("b", "pending", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($(".trade-chat")).toBeNull();
    expect($(".receive-box")).toBeNull();
    act(() => root?.unmount()); el.remove();
    requests = [req("a", "approved"), req("b", "rejected", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($("main .alert.warn")?.textContent).toBe("1農家が対応できないため、この仕入れ案では取引できません。仕入れ案を作り直してください。");
    expect($(".trade-chat")).toBeNull();
    expect($(".receive-box")).toBeNull();
    expect(calls.some((c) => c.url.includes("/messages"))).toBe(false);
  });
  it("生産者：成立前は案内だけ、成立後はやり取り、完了後は「取引完了」と読むだけのやり取り", async () => {
    me = producer;
    requests = [
      req("a", "approved", { established: false, restaurantName: "成立前の店" }),
      req("b", "approved", { established: true, restaurantName: "取引中の店" }),
      req("c", "approved", { established: true, receivedAt: "2026-10-22T05:00:00.000Z", restaurantName: "完了した店" }),
    ];
    await open("/producer/requests");
    const rows = [...el.querySelectorAll(".request-list .farm-row")];
    const rowOf = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
    expect(rowOf("成立前の店").querySelector(".trade-chat")).toBeNull();
    expect(rowOf("成立前の店").textContent).toContain("ほかの農家の返事がそろうと、飲食店とやり取りできるようになります");
    expect(rowOf("取引中の店").querySelector(".trade-chat textarea")).not.toBeNull();
    expect(rowOf("完了した店").querySelector(".state-tag")?.textContent).toBe("取引完了");
    expect(rowOf("完了した店").textContent).toContain("取引完了：飲食店が受け取りを完了しました");
    expect(rowOf("完了した店").querySelector(".trade-chat textarea")).toBeNull();
    expect(calls.filter((c) => c.url.endsWith("/messages")).map((c) => c.url).sort()).toEqual(["/api/approvals/b/messages", "/api/approvals/c/messages"]);
  });
});

describe("取引後の評価と「☆ いつもの農家」（受け取り完了後だけ・農家ごと）", () => {
  const typeInto = async (input: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const boxOf = (name: string) => [...el.querySelectorAll(".review-box")].find((b) => b.getAttribute("aria-label") === `${name}との取引の評価`)!;
  const pick = async (box: Element, label: string) => {
    const input = [...box.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((i) => i.closest("label")?.textContent?.includes(label))!;
    await act(async () => { input.click(); });
  };
  const done = "2026-10-22T05:00:00.000Z";

  it("飲食店：2農家の取引を農家ごとに評価し、評価とは別に「☆ いつもの農家に登録」できる", async () => {
    me = restaurant;
    requests = [req("a", "approved", { established: true, receivedAt: done }), req("b", "approved", { established: true, receivedAt: done, producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($("#review-title")?.textContent).toBe("取引の評価");
    const a = boxOf("A農園"), b = boxOf("B農園");
    expect(a.querySelector("legend")?.textContent).toBe("今回の取引はいかがでしたか？");
    expect([...a.querySelectorAll(".option-card b")].map((x) => x.textContent)).toEqual(["良かった", "残念だった"]);
    expect(a.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true); // 選ぶまで送れない
    // 一言は100文字まで
    await typeInto(a.querySelector("textarea")!, "あ".repeat(101));
    await pick(a, "良かった");
    expect(a.textContent).toContain("一言コメントは100文字以内で入力してください");
    expect(a.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true);
    await typeInto(a.querySelector("textarea")!, "  丁寧でした  ");
    await click(a.querySelector("button[type=submit]"));
    expect(calls.filter((c) => c.url.endsWith("/review") && c.method === "POST").map((c) => [c.url, c.body])).toEqual([["/api/approvals/a/review", { rating: "good", comment: "丁寧でした" }]]);
    expect(a.querySelector(".review-done")?.textContent).toBe("評価済み：良かった「丁寧でした」");
    expect(a.querySelector("form")).toBeNull();
    expect(b.querySelector("form")).not.toBeNull(); // B農園はまだ（農家ごと）
    // いつもの農家：評価していない B農園でも登録できる（評価の内容で自動登録しない）
    expect(a.querySelector(".usual-tag")).toBeNull();
    await click(b.querySelector("button[aria-label='B農園をいつもの農家に登録']"));
    expect(calls.filter((c) => c.url.endsWith("/usual")).map((c) => c.url)).toEqual(["/api/approvals/b/usual"]);
    expect(b.querySelector(".usual-tag")?.textContent).toBe("☆ いつもの農家");
    expect([...b.querySelectorAll("button")].some((x) => x.textContent?.includes("いつもの農家に登録"))).toBe(false);
    expect(a.querySelector(".usual-tag")).toBeNull();
    expect([...a.querySelectorAll("button")].some((x) => x.textContent?.includes("☆ いつもの農家に登録"))).toBe(true);
  });
  it("飲食店：受け取り完了前（マッチ成立）は評価・いつもの農家を出さず、API も呼ばない", async () => {
    me = restaurant;
    requests = [req("a", "approved", { established: true, receivedAt: null })];
    await open("/restaurant/consultations/fp-1");
    expect($(".review-box")).toBeNull();
    expect($("#review-title")).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/review") || c.url.endsWith("/usual"))).toBe(false);
  });
  it("生産者：完了した取引だけ評価できる（いつもの農家のボタンは出さない）", async () => {
    me = producer;
    requests = [
      req("b", "approved", { established: true, restaurantName: "取引中の店" }),
      req("c", "approved", { established: true, receivedAt: done, restaurantName: "完了した店" }),
    ];
    reviewState = { c: { review: null, usual: null } };
    await open("/producer/requests");
    const rowOf = (name: string) => [...el.querySelectorAll(".request-list .farm-row")].find((r) => r.textContent?.includes(name))!;
    expect(rowOf("取引中の店").querySelector(".review-box")).toBeNull();
    const box = rowOf("完了した店").querySelector(".review-box")!;
    expect(box.getAttribute("aria-label")).toBe("完了した店との取引の評価");
    expect(box.textContent).toContain("評価は相手やほかの利用者には表示されません");
    expect(box.querySelector(".review-head")).toBeNull();
    expect([...box.querySelectorAll("button")].some((x) => x.textContent?.includes("いつもの農家"))).toBe(false);
    await pick(box, "残念だった");
    await click(box.querySelector("button[type=submit]"));
    expect(calls.filter((c) => c.url.endsWith("/review") && c.method === "POST").map((c) => [c.url, c.body])).toEqual([["/api/approvals/c/review", { rating: "bad", comment: "" }]]);
    expect(box.querySelector(".review-done")?.textContent).toBe("評価済み：残念だった");
    expect(calls.filter((c) => c.url.endsWith("/review")).map((c) => c.url)).toEqual(["/api/approvals/c/review", "/api/approvals/c/review"]);
  });
});

const restaurantProfile = () => ({
  role: "restaurant",
  profile: {
    name: "まちの食堂", businessType: "izakaya", businessTypeOther: "", prefecture: "大阪府", city: "大阪市北区", address: "", phone: "06-0000-0000",
    purchaseFrequency: "few_times_weekly", purchaseVolume: "small", irregularPolicy: "welcome", firstTimePolicy: "include", pickupTimes: [], priorities: ["local"],
  },
});
const producerProfile = () => ({
  role: "producer",
  profile: {
    farmName: "みどり農園", producerName: "山田 花子", prefecture: "大阪府", city: "堺市南区", itemIds: ["i-tomato"], otherCrops: "かぼちゃ",
    productionStyle: "many_small", salesChannels: [], directTradeExperience: "sometimes", capabilities: ["small_lot"], seriesIds: ["s-a"],
    contactPhone: "000-0000-9999", contactEmail: "",
  },
  items: [{ id: "i-tomato", name: "トマト" }, { id: "i-onion", name: "玉ねぎ" }],
  series: [{ id: "s-a", placeName: "梅田エリア受渡所（仮）", placeAddress: "大阪市北区", weekday: 2, startTime: "10:00", endTime: "11:00", feeYen: 800, active: true }],
});

describe("マイページ", () => {
  it("飲食店：まとめて表示し、「編集」を押した区切りだけ変更・保存する", async () => {
    me = restaurant;
    profile = restaurantProfile();
    await open("/restaurant/mypage");
    expect($(".style-text")?.textContent).toBe("地元産 × 少量仕入れ × 規格外OK");
    for (const t of ["居酒屋", "大阪府大阪市北区", "06-0000-0000", "週2〜3回", "少量中心", "積極的に使いたい", "新しい農家も候補に入れる", "地元・近さ"]) expect(text()).toContain(t);
    expect(text()).toContain("設定していません"); // 詳しい住所
    expect(el.querySelectorAll("form")).toHaveLength(0);
    await click(el.querySelector('button[aria-label="お店を編集する"]'));
    expect(el.querySelectorAll("form")).toHaveLength(1);
    expect(el.querySelectorAll('button[aria-label$="を編集する"]')).toHaveLength(0); // 編集中はほかの区切りを開かない
    const input = $<HTMLInputElement>('input[name="name"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "まちの食堂 本店");
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button("保存する"));
    const sent = calls.find((c) => c.method === "PATCH");
    expect(sent?.body).toMatchObject({ name: "まちの食堂 本店", purchaseVolume: "small", priorities: ["local"] }); // ほかの区切りの値はそのまま送る
    expect(text()).toContain("「お店」を保存しました");
    expect(el.querySelectorAll("form")).toHaveLength(0);
    expect(text()).not.toContain("マイページで設定");
  });
  it("生産者：連絡先を両方消すと保存せず、項目の近くに理由を出す", async () => {
    me = producer;
    profile = producerProfile();
    await open("/producer/mypage");
    expect($(".style-text")?.textContent).toBe("少量OK × 直接取引の経験あり × 少量多品目");
    for (const t of ["山田 花子", "大阪府堺市南区", "トマト", "かぼちゃ", "少量多品目", "経験あり", "少量での販売", "000-0000-9999"]) expect(text()).toContain(t);
    await click(el.querySelector('button[aria-label="飲食店に伝える連絡先を編集する"]'));
    const phone = $<HTMLInputElement>('input[name="contactPhone"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(phone, "");
    await act(async () => { phone.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button("保存する"));
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect($(".field-error")?.textContent).toContain("電話番号かメールアドレスのどちらかを入力してください");
    await click(button("やめる"));
    expect(text()).toContain("000-0000-9999");
  });
  it("生産者：対応できる取引は3つから選ぶ。「余剰が出たときだけ」は出さないが、保存済みの値は消さずに送る", async () => {
    me = producer;
    const base = producerProfile();
    profile = { ...base, profile: { ...base.profile, capabilities: ["surplus", "small_lot"] } };
    await open("/producer/mypage");
    expect(text()).not.toContain("余剰");
    await click(el.querySelector('button[aria-label="対応できる取引を編集する"]'));
    expect([...el.querySelectorAll('input[name="capabilities"]')].map((i) => i.closest("label")!.querySelector("b")!.textContent)).toEqual(["規格外品の販売", "少量での販売", "飲食店との直接取引"]);
    await click([...el.querySelectorAll<HTMLInputElement>('input[name="capabilities"]')][0]);
    await click(button("保存する"));
    const sent = calls.find((c) => c.url === "/api/profile" && c.method === "PATCH")!.body as { capabilities: string[] };
    expect(sent.capabilities).toEqual(["surplus", "small_lot", "irregular"]);
  });
});

describe("生産者のマイページ：いま出品しているもの", () => {
  beforeEach(() => { me = producer; });
  it("一般向け：最初に、品目 → 状態 → 残り → 価格 → 「編集する」を商品ごとに出す（公開中／止めています／売り切れ）", async () => {
    profile = producerProfile();
    supplyRows = [
      supplyRow(),
      supplyRow({ id: "sp2", item: { name: "なす" }, grade: "irregular", availableKg: 5, priceYenPerKg: 450, published: false }),
      supplyRow({ id: "sp3", item: { name: "きゅうり" }, availableKg: 0, priceYenPerKg: 300, published: true }),
    ];
    await open("/producer/mypage");
    const sec = $(".listings-summary")!;
    // 販売スタイル・農園の情報より前にある
    expect([...el.querySelectorAll("main .listings-summary, main .style-card")].map((x) => x.className)).toEqual(["listings-summary", "style-card"]);
    const rows = [...sec.querySelectorAll(".my-listing")].map((li) => [li.querySelector(".my-listing-name")?.textContent, li.querySelector(".my-listing-state")?.textContent, li.querySelector(".my-listing-qty")?.textContent, li.querySelector(".my-listing-price")?.textContent, li.querySelector("a")?.textContent]);
    expect(rows).toEqual([
      ["トマト", "公開中", "残り 8kg", "価格 ¥600/kg", "編集する"],
      ["なす規格外", "止めています", "残り 5kg", "価格 ¥450/kg", "編集する"],
      ["きゅうり", "売り切れ", "残り 0kg", "価格 ¥300/kg", "編集する"],
    ]);
    expect([...sec.querySelectorAll(".my-listing")].map((li) => li.className)).toEqual(["my-listing on", "my-listing off", "my-listing soldout"]);
    // 「編集する」はその商品のところへ（読み上げでも、どの商品か分かる）
    const edit = sec.querySelectorAll<HTMLAnchorElement>(".my-listing-edit")[1];
    expect(edit.getAttribute("href")).toBe("/producer/listings#supply-sp2");
    expect(edit.getAttribute("aria-label")).toBe("なすを編集する");
    expect(text()).not.toContain("停止中");
    await click(edit);
    expect(path).toBe("/producer/listings");
  });
  it("「編集する」から開いた「出品」の画面：その商品が枠で囲まれ、移動先になる。数量の欄は「残りの量」", async () => {
    supplyRows = [supplyRow(), supplyRow({ id: "sp2", item: { name: "なす" }, availableKg: 10, published: true })].map((r) => ({ ...r, version: 1, originPrefecture: "大阪府" }));
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); } as Element["scrollIntoView"];
    onTestFinished(() => { Element.prototype.scrollIntoView = original; });
    await open("/producer/listings#supply-sp2");
    const card = $("#supply-sp2")!;
    expect(card.classList.contains("targeted")).toBe(true);
    expect($("#supply-sp1")!.classList.contains("targeted")).toBe(false);
    expect(scrolled).toEqual(["supply-sp2"]);
    expect(document.activeElement).toBe(card); // キーボードは開かない（数量の欄にはフォーカスしない）
    expect(card.querySelector(".qty-label")?.textContent).toBe("残りの量");
    expect(card.querySelector<HTMLInputElement>("input[type=number]")?.getAttribute("aria-label")).toBe("なすの残りの量");
  });
  it("「出品」の画面の公開の状態：公開中で 0kg は「売り切れ」（マイページと同じ）。公開中・公開を停止中の表示は今のまま", async () => {
    supplyRows = [
      supplyRow(),
      supplyRow({ id: "sp2", item: { name: "なす" }, availableKg: 5, published: false }),
      supplyRow({ id: "sp3", item: { name: "きゅうり" }, availableKg: 0, published: true }),
      supplyRow({ id: "sp4", item: { name: "玉ねぎ" }, availableKg: 0, published: false }),
    ].map((r) => ({ ...r, version: 1, originPrefecture: "大阪府" }));
    await open("/producer/listings");
    const state = (id: string) => { const p = $(`#supply-${id} .publish-state`)!; return [p.className, p.textContent]; };
    expect(state("sp1")).toEqual(["publish-state on", "公開中飲食店に表示されています"]);
    expect(state("sp2")).toEqual(["publish-state off", "公開を停止中飲食店には表示されません"]);
    expect(state("sp3")).toEqual(["publish-state soldout", "売り切れ仕入れ案には使われません。量を増やすと、また使われます"]);
    expect(state("sp4")).toEqual(["publish-state off", "公開を停止中飲食店には表示されません"]); // 止めている 0kg は止めているまま
    expect($("#supply-sp3 .publish-btn")?.textContent).toBe("公開を止める"); // 公開の状態・ボタンは変わらない
  });
  it("デモ用の環境でも同じ一覧を出す（出品がなければその旨）", async () => {
    mode = "demo";
    supplyRows = [];
    await open("/producer/mypage");
    expect($(".listings-summary .empty-note")?.textContent).toBe("まだ出品はありません");
  });
});

describe("デモ用の環境のマイページ（連絡先だけ編集できる）", () => {
  const typeInto = async (name: string, value: string) => {
    const input = $<HTMLInputElement>(`input[name="${name}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  it("生産者：今の連絡先を表示し、電話だけ・メールだけで保存できる。両方空は保存しない", async () => {
    mode = "demo";
    me = producer;
    await open("/producer/mypage");
    expect(calls.some((c) => c.url === "/api/profile")).toBe(false); // 一般ユーザー用のプロフィールは使わない
    expect(text()).toContain("000-0000-0001");
    expect(text()).toContain("a-farm@example.invalid");
    await click(el.querySelector('button[aria-label="飲食店に伝える連絡先を編集する"]'));
    expect(text()).toContain("ログイン用の情報とは別です");
    await typeInto("contactEmail", "");
    await click(button("保存する"));
    expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ contactPhone: "000-0000-0001", contactEmail: "" });
    expect(text()).toContain("保存しました");
    expect(text()).toContain("設定していません");

    await click(el.querySelector('button[aria-label="飲食店に伝える連絡先を編集する"]'));
    await typeInto("contactPhone", "");
    await typeInto("contactEmail", "new-a@example.invalid");
    await click(button("保存する"));
    expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ contactPhone: "", contactEmail: "new-a@example.invalid" });
    expect(contact).toEqual({ contactPhone: null, contactEmail: "new-a@example.invalid" });

    const before = calls.filter((c) => c.method === "PATCH").length;
    await click(el.querySelector('button[aria-label="飲食店に伝える連絡先を編集する"]'));
    await typeInto("contactEmail", "");
    await click(button("保存する"));
    expect(calls.filter((c) => c.method === "PATCH").length).toBe(before);
    expect($(".field-error")?.textContent).toContain("どちらかを入力してください");
  });
  it("飲食店（demo-r など）には連絡先の編集を出さない", async () => {
    mode = "demo";
    me = restaurant;
    await open("/restaurant/mypage");
    expect(text()).not.toContain("飲食店に伝える連絡先");
    expect(calls.some((c) => c.url.includes("view=contact"))).toBe(false);
  });
});

describe("生産者：いつもの受け渡し場所（物流の言葉を使わず、3つの質問で登録）", () => {
  beforeEach(() => { me = producer; });
  const typeInto = async (name: string, value: string) => {
    const input = $<HTMLInputElement>(`input[name="${name}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const typeIntoEl = async (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const posted = () => calls.filter((c) => c.url === "/api/pickup-points" && c.method === "POST").map((c) => c.body);

  it("ホーム：未登録なら「いつもの受け渡し場所：未登録」、登録済みなら場所の名前（受渡枠という言葉は出さない）", async () => {
    pickup = { ...pickup, usual: [] };
    await open("/producer/home");
    expect($(".usual-status")?.textContent).toContain("いつもの受け渡し場所：未登録");
    expect(text()).not.toContain("受渡枠");
    act(() => root?.unmount()); el.remove();
    pickup = { ...pickup, usual: [usualUmeda] };
    await open("/producer/home");
    expect($(".usual-status")?.textContent).toBe("いつもの受け渡し場所：梅田エリア受渡所（仮）");
    expect(text()).toContain("次の受け渡し");
  });
  it("デモ用の環境のホームは、いつもの受け渡し場所を出さない", async () => {
    mode = "demo";
    await open("/producer/home");
    expect($(".usual-status")).toBeNull();
    expect($(".next-slot")?.textContent).toContain("梅田エリア受渡所（仮）");
  });

  it("マイページ：いつもの場所をカードで出す。追加は場所の名前と住所だけ（曜日・時間は聞かない）。登録済みの場所から選ぶこともできる", async () => {
    profile = producerProfile();
    await open("/producer/mypage");
    const card = $(".usual-place")!;
    expect(card.textContent).toContain("梅田エリア受渡所（仮）");
    expect(card.textContent).toContain("火曜日 10:00〜11:00"); // 以前に曜日・時間つきで登録した場所は、その曜日と時間も出す
    await click(button("場所を追加する"));
    expect($(".ps-title")?.textContent).toBe("普段、野菜をどこで渡せますか？");
    await click(button("いつもの直売所"));
    // どの種類でも、まず場所の名前と住所の入力（共通）。登録済みの場所は補助
    expect($('input[name="name"]')).not.toBeNull();
    expect($('input[name="address"]')).not.toBeNull();
    expect(el.querySelector(".ps-weekday, input[type=time]")).toBeNull();
    expect($(".ps-place")).toBeNull();
    await click(button("登録済みの場所から選ぶ"));
    expect([...el.querySelectorAll(".ps-place-name")].map((x) => x.textContent)).toEqual(["南区ふれあい直売所"]); // 直売所の候補だけ（運営の場所は「その他」に出る）
    expect($(".ps-place .ps-place-address")).toBeNull(); // 住所のない候補は住所の行を出さない
    await click(button("ここで渡せる"));
    await flush();
    expect(posted()).toEqual([{ placeId: "pl-store" }]);
    expect(text()).toContain("いつもの受け渡し場所を登録しました");
    expect([...el.querySelectorAll(".usual-place-name")].map((x) => x.textContent)).toContain("南区ふれあい直売所");
  });

  it("はじめての出品（一般向け・場所がない）：出品の前に場所の名前と住所を聞く。「その他」でも入力した場所の名前を出す。終わると出品へ進む", async () => {
    supplyRows = [];
    slots = [];
    pickup = { ...pickup, usual: [] };
    await open("/producer/listings/new");
    expect($(".first-place")).not.toBeNull();
    expect($(".ps-title")?.textContent).toBe("普段、野菜をどこで渡せますか？");
    expect($("form")).toBeNull(); // 出品の入力はまだ出さない
    expect($(".entry-choices")).toBeNull();
    await click(button("その他"));
    await click(button("この場所を登録する"));
    expect(posted()).toHaveLength(0);
    expect(text()).toContain("場所の名前を入れてください");
    await click(button("登録済みの場所から選ぶ"));
    expect([...el.querySelectorAll(".ps-place-name")].map((x) => x.textContent)).toEqual(["梅田エリア受渡所（仮）"]);
    expect($(".ps-place .ps-place-address")?.textContent).toBe("大阪市北区"); // 運営の場所は住所あり
    await typeInto("name", "〇〇公民館");
    await typeInto("address", "大阪府堺市南区9-9");
    await click(button("この場所を登録する"));
    await flush();
    expect(posted()).toEqual([{ name: "〇〇公民館", address: "大阪府堺市南区9-9", kind: "other" }]);
    expect($(".first-place")).toBeNull();
    // 出品の入口へ進み、手入力では受け渡しにいつもの場所（入力した名前。「その他」とは出さない）が選ばれている
    expect($(".entry-choices")).not.toBeNull();
    await click(button("手で入力する"));
    expect($(".pickup-current-place")?.textContent).toBe("いつもの〇〇公民館");
    expect(text()).not.toContain("その他");
  });

  it("出品の受け渡し：いつもの場所は選んだ状態で、今回渡せる日と時間帯（午前／午後）を選ぶ。選ぶまでは登録しない", async () => {
    await open("/producer/listings/new");
    await click(button("手で入力する"));
    expect($(".pickup-current-place")?.textContent).toBe("いつもの梅田エリア受渡所（仮）");
    expect($('[data-field="handover"]')?.textContent).toContain("細かい時間は、マッチングの後に飲食店とのやり取りで決められます");
    const dates = el.querySelectorAll('[aria-labelledby="hd-date"] .pickup-option');
    expect(dates).toHaveLength(7);
    expect(button("もっと先の日")).toBeTruthy();
    expect($('[aria-labelledby="hd-period"]')).toBeNull(); // 日を選ぶまで時間帯は出さない
    const r = el.querySelector<HTMLFieldSetElement>(".supply-new-row")!;
    const nums = r.querySelectorAll<HTMLInputElement>('input[type="number"]');
    await typeIntoEl(r.querySelector<HTMLInputElement>('input[name="itemName"]')!, "トマト");
    await typeIntoEl(nums[0], "5");
    await typeIntoEl(nums[1], "600");
    await click(el.querySelectorAll<HTMLInputElement>('input[name="pub"]')[1]);
    await click(button("登録する"));
    expect(calls.some((c) => c.url === "/api/supplies" && c.method === "POST")).toBe(false);
    expect(text()).toContain("受け渡しの場所・渡せる日・時間帯を選んでください");
    await click(dates[1]);
    expect([...el.querySelectorAll('[aria-labelledby="hd-period"] .pickup-option')].map((b) => b.textContent)).toEqual(["午前（9:00〜12:00）", "午後（13:00〜17:00）"]);
    await click(button("午後（13:00〜17:00）"));
    await click(button("登録する"));
    await flush();
    const post = calls.find((c) => c.url === "/api/supplies" && c.method === "POST")!.body as Record<string, unknown>;
    expect(post.handover).toEqual({ placeId: "pl-umeda", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), period: "pm" });
    expect(post).not.toHaveProperty("slotId");
  });

  it("いつもの場所が複数なら場所を切り替えられる。デモ用の環境では今までどおり受渡の回を選び、場所を聞かない", async () => {
    pickup = { ...pickup, usual: [usualUmeda, { placeId: "pl-farm", name: "自分の作業場", address: "堺市", kind: "farm", times: [] }] };
    await open("/producer/listings/new");
    await click(button("手で入力する"));
    expect([...el.querySelectorAll('[aria-label="場所"] .pickup-option')].map((b) => b.textContent)).toEqual(["梅田エリア受渡所（仮）", "自分の作業場"]);
    await click(button("自分の作業場"));
    expect(button("自分の作業場")?.getAttribute("aria-pressed")).toBe("true");
    act(() => root?.unmount()); el.remove();
    mode = "demo";
    await open("/producer/listings/new");
    expect($(".first-place")).toBeNull();
    await click(button("手で入力する"));
    expect($('[data-field="handover"]')).toBeNull();
    expect($(".pickup-current-place")?.textContent).toBe("いつもの梅田エリア受渡所（仮）");
    expect(calls.some((c) => c.url === "/api/pickup-points")).toBe(false);
  });
});

describe("出品：複数の商品を1つの画面から登録（品目は候補つきの自由入力）", () => {
  beforeEach(() => { me = producer; });
  /** 出品の画面を開き、「手で入力する」を選ぶ */
  const openForm = async () => { await open("/producer/listings/new"); await click(button("手で入力する")); };
  const typeInto = async (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const rowInputs = (i: number) => {
    const row = el.querySelectorAll<HTMLFieldSetElement>(".supply-new-row")[i];
    const numbers = row.querySelectorAll<HTMLInputElement>('input[type="number"]'); // 販売できる量・価格・最低販売量の順
    return { row, item: row.querySelector<HTMLInputElement>('input[name="itemName"]')!, kg: numbers[0], price: numbers[1] };
  };
  const posts = () => calls.filter((c) => c.url === "/api/supplies" && c.method === "POST").map((c) => c.body as Record<string, unknown>);
  const fillRow = async (i: number, name: string, kg: string, price: string) => {
    const r = rowInputs(i);
    await typeInto(r.item, name);
    await typeInto(r.kg, kg);
    await typeInto(r.price, price);
  };
  /** 受け渡し（いちばん近い渡せる日と、その日の最初の時間帯）と「公開する」を選ぶ */
  const choosePublish = async () => {
    await click(el.querySelectorAll('[aria-labelledby="hd-date"] .pickup-option')[0]);
    const period = el.querySelector('[aria-labelledby="hd-period"] .pickup-option');
    if (period && period.getAttribute("aria-pressed") !== "true") await click(period);
    await click(el.querySelectorAll<HTMLInputElement>('input[name="pub"]')[1]);
  };

  it("品目は自由入力が主役：空のうちは候補の一覧を出さず、入力を始めたら既存の品目を候補に出す。新しい品目名には「新しい品目として登録します」", async () => {
    await openForm();
    expect(rowInputs(0).item.getAttribute("placeholder")).toBe("例：キャベツ、泉州水なす、九条ねぎ");
    expect(rowInputs(0).item.hasAttribute("list")).toBe(false); // 選択肢から選ぶ欄に見せない
    expect(rowInputs(0).row.textContent).toContain("自由に入力できます");
    await typeInto(rowInputs(0).item, "ト");
    expect(rowInputs(0).item.getAttribute("list")).toBe("supply-item-options");
    expect([...el.querySelectorAll("#supply-item-options option")].map((o) => o.getAttribute("value"))).toEqual(["トマト", "なす"]);
    await typeInto(rowInputs(0).item, "万願寺とうがらし");
    expect(rowInputs(0).row.textContent).toContain("新しい品目として登録します");
    await typeInto(rowInputs(0).item, "ナス"); // 表記の違いは既存の品目
    expect(rowInputs(0).row.textContent).not.toContain("新しい品目として登録します");
  });
  it("産地：農園の所在地の都道府県を最初から選んでおく。関西の6府県を先に並べ、ほかの都道府県も選べる", async () => {
    await openForm();
    const select = [...el.querySelectorAll<HTMLSelectElement>(".listing-form select")].find((s) => s.querySelector("optgroup"))!;
    expect(select.value).toBe("大阪府");
    const groups = [...select.querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)]);
    expect(groups).toEqual([["関西", ["大阪府", "京都府", "兵庫県", "奈良県", "和歌山県", "滋賀県"]], ["その他の都道府県", ["東京都"]]]);
  });
  it("「＋ 商品を追加」で3品目を1回で登録：既存の品目は itemId、新しい品目は itemName で、1行ずつ送る", async () => {
    supplyRows = [];
    await openForm();
    await click(button("商品を追加"));
    await click(button("商品を追加"));
    expect(el.querySelectorAll(".supply-new-row")).toHaveLength(3);
    await fillRow(0, "トマト", "5", "600");
    await fillRow(1, "ナス", "8", "450");
    await fillRow(2, "万願寺とうがらし", "3", "900");
    await choosePublish();
    expect(button("3件を登録する")).toBeTruthy();
    await click(button("3件を登録する"));
    await flush();
    expect(posts().map((b) => [b.itemId ?? null, b.varietyId ?? null, b.itemName ?? null, b.availableKg])).toEqual([
      ["i-tomato", "v-tomato", null, "5"], ["i-nasu", "v-nasu", null, "8"], [null, null, "万願寺とうがらし", "3"],
    ]);
    const h = posts()[0].handover as { placeId: string; date: string; period: string };
    expect(h.placeId).toBe("pl-umeda");
    expect(posts().every((b) => JSON.stringify(b.handover) === JSON.stringify(h) && !("slotId" in b) && b.originPrefecture === "大阪府" && b.published === true)).toBe(true); // 受け渡し・産地・公開は全行に共通
    // 全部登録できたら完了の画面：ホームへ／続けて出品する
    expect($(".entry-done [role=status]")?.textContent).toContain("3件を登録しました（トマト 5kg・なす 8kg・万願寺とうがらし 3kg）");
    expect($(".listing-form")).toBeNull();
    expect(button("ホームへ")?.getAttribute("href")).toBe("/producer/home");
    await click(button("続けて出品する"));
    expect($(".entry-choices")).not.toBeNull();
  });
  it("同じ画面の中で同じ品目（表記違いも含む）が2行あれば、送る前に止める", async () => {
    await openForm();
    await click(button("商品を追加"));
    await fillRow(0, "なす", "5", "400");
    await fillRow(1, "ナス", "3", "400");
    await choosePublish();
    await click(button("2件を登録する"));
    expect(posts()).toHaveLength(0);
    expect([...el.querySelectorAll(".supply-new-row-status")].map((x) => x.textContent)).toEqual(["同じ品目がほかの行にもあります。1つの行にまとめてください", "同じ品目がほかの行にもあります。1つの行にまとめてください"]);
    expect($(".listing-form [role=status]")?.textContent).toContain("まだ登録していません");
  });
  it("一部だけ失敗：登録できた行は消え、できなかった行は理由（すでに出品中など）つきで残る", async () => {
    supplyPost = (b, json) => (b.itemId === "i-tomato"
      ? json({ error: "同じ品目・受渡枠の供給がすでにあります。数量の変更をご利用ください" }, 409)
      : json({ supply: { item: { name: (b.itemName as string) ?? "なす" }, availableKg: Number(b.availableKg) } }, 201));
    await openForm();
    await click(button("商品を追加"));
    await fillRow(0, "トマト", "5", "600");
    await fillRow(1, "水なす", "2", "700");
    await choosePublish();
    await click(button("2件を登録する"));
    await flush();
    expect(posts()).toHaveLength(2);
    const left = el.querySelectorAll(".supply-new-row");
    expect(left).toHaveLength(1);
    expect(rowInputs(0).item.value).toBe("トマト");
    expect(left[0].querySelector(".supply-new-row-status")?.textContent).toContain("数量の変更をご利用ください");
    expect($(".listing-form [role=status]")?.textContent).toContain("1件を登録しました（水なす 2kg）。1件は登録できませんでした");
  });
  it("出品の入口は「写真を撮る」「手で入力する」（音声認識のない端末では「話して入力する」は出さない）。一覧からは「新しく出品する」で来る", async () => {
    await open("/producer/listings");
    expect(button("新しく出品する")?.getAttribute("href")).toBe("/producer/listings/new");
    act(() => root?.unmount()); el.remove();
    await open("/producer/listings/new");
    expect([...el.querySelectorAll(".entry-choice b")].map((b) => b.textContent)).toEqual(["写真を撮る", "手で入力する"]);
    expect($<HTMLInputElement>('input[type="file"]')?.getAttribute("accept")).toBe("image/*");
    expect($("form")).toBeNull();
  });
  it("話して入力：AI の下書き（品目・量・価格）が入った状態で開き、直してから登録する。AI が使えなければ手入力へ案内", async () => {
    class FakeRecognition {
      lang = ""; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() { setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "なす 8キロ 1キロ450円" }], { isFinal: true })] }); this.onend?.(); }, 0); }
      stop() {} abort() {}
    }
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    // AI が使えない：入口に戻り、理由を出す（文は消さない・登録しない）
    await open("/producer/listings/new");
    await click(button("話して入力する"));
    await flush();
    expect(calls.filter((c) => c.url === "/api/supply-draft").map((c) => c.body)).toEqual([{ text: "なす 8キロ 1キロ450円" }]);
    expect($(".entry .alert.bad")?.textContent).toContain("手で入力してください");
    // AI が使える：下書きの入ったフォーム
    draftReply = { itemName: "なす", availableKg: 8, priceYenPerKg: 450, grade: null };
    await click(button("話して入力する"));
    await flush();
    expect($(".draft-note")?.textContent).toContain("「なす 8キロ 1キロ450円」から読み取りました");
    const row = el.querySelector(".supply-new-row")!;
    const numbers = row.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect([row.querySelector<HTMLInputElement>('input[name="itemName"]')!.value, numbers[0].value, numbers[1].value]).toEqual(["なす", "8", "450"]);
    expect(calls.some((c) => c.url === "/api/supplies" && c.method === "POST")).toBe(false); // 下書きだけでは登録しない
  });
  it("品目名の形が違う（記号）・空の行は送らずに理由を出す", async () => {
    await openForm();
    await fillRow(0, "<b>", "5", "600");
    await choosePublish();
    await click(button("登録する"));
    expect(posts()).toHaveLength(0);
    expect($(".supply-new-row-status")?.textContent).toContain("記号は使えません");
  });
});
