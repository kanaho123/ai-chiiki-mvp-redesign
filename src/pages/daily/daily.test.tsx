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
const usualUmeda = { placeId: "pl-umeda", name: "梅田エリア受渡所（仮）", address: "大阪市北区", kind: null, times: [{ seriesId: "s-umeda", weekday: 2, startTime: "10:00", endTime: "11:00", active: true }] };
let pickup: { usual: unknown[]; candidates: { placeId: string; name: string; address: string; kind: string | null }[] } = { usual: [], candidates: [] };
beforeEach(() => {
  supplyPost = defaultSupplyPost;
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
    if (url === "/api/supplies") return json({ supplies: supplyRows, slots, items: [{ id: "i-tomato", name: "トマト", varieties: [{ id: "v-tomato", name: "指定なし" }] }, { id: "i-nasu", name: "なす", varieties: [{ id: "v-nasu", name: "指定なし" }] }], prefectures: ["大阪府"] });
    if (url === "/api/pickup-points" && method === "GET") return json({ points: [], ...pickup });
    if (url === "/api/pickup-points" && method === "POST") {
      const b = body as { placeId?: string; name?: string; weekday: number; startTime: string; endTime: string };
      const name = b.placeId ? pickup.candidates.find((c) => c.placeId === b.placeId)!.name : b.name!;
      const added = { placeId: b.placeId ?? "pl-new", name, address: "", kind: null, times: [{ seriesId: "s-new", weekday: b.weekday, startTime: b.startTime, endTime: b.endTime, active: true }] };
      pickup = { ...pickup, usual: [...pickup.usual, added] };
      slots = [{ id: "sl-new", label: "", placeId: added.placeId, placeName: name, startAt: "2099-10-30T07:00:00.000Z", endAt: "2099-10-30T09:00:00.000Z", participationConfirmed: true }];
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
  it("相談なし：「進行中の相談はありません」と仕入れ案をつくる主ボタン", async () => {
    await open("/restaurant/home");
    expect($("main h1")?.textContent).toBe("まちの食堂");
    expect(text()).toContain("進行中の相談はありません");
    expect($(".todo-text")?.textContent).toContain("仕入れ案をつくりましょう");
    expect(el.querySelectorAll("main .btn-primary")).toHaveLength(1);
    expect($("main .btn-primary")?.textContent).toBe("新しい仕入れ案をつくる");
  });
  it("返事待ち：「トマト 10kg」と農家ごとの状態をふつうの言葉で", async () => {
    requests = [req("a", "pending"), req("b", "pending", { producerName: "B農園" })];
    await open("/restaurant/home");
    expect($(".consult-title")?.textContent).toBe("トマト 10kg");
    expect([...el.querySelectorAll(".farm-line")].map((x) => x.textContent)).toEqual(["A農園：返事待ち", "B農園：返事待ち"]);
    expect($(".consult-card .state-tag")?.textContent).toBe("返事待ち");
    expect($(".todo-text")?.textContent).toContain("返事を待っています");
  });
  it("全農家が対応できる：「マッチ成立」と取引相談への案内を「今やること」に", async () => {
    requests = [req("a", "approved"), req("b", "approved", { producerName: "B農園" })];
    await open("/restaurant/home");
    expect($(".consult-card .state-tag")?.textContent).toBe("マッチ成立");
    expect($(".todo-text")?.textContent).toBe("🎉 マッチ成立：A農園・B農園と条件がそろいました。取引相談へ進みましょう（注文確定ではありません）");
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
  it("詳細：全農家が対応できる相談は「🎉 マッチ成立」と注文確定ではない旨、取引相談へ進む", async () => {
    requests = [req("a", "approved"), req("b", "approved", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($(".match-banner .match-title")?.textContent).toBe("🎉 マッチ成立");
    expect($(".match-banner .match-text")?.textContent).toBe("A農園・B農園と、数量・価格・受け渡し条件がそろいました");
    expect($(".match-banner .match-note")?.textContent).toBe("これは注文確定ではありません。在庫の確保も行われません。");
    expect($("main .state-tag")?.textContent).toBe("マッチ成立");
    // 進み具合：相談送信済み・生産者回答待ち・マッチ成立は済み、いまは受け渡し待ち
    expect([...el.querySelectorAll(".progress-step")].map((s) => `${s.querySelector(".progress-label")?.textContent}:${s.className.replace("progress-step ", "")}`))
      .toEqual(["相談送信済み:done", "生産者回答待ち:done", "マッチ成立:done", "受け渡し待ち:current"]);
    expect($(".progress-current")?.textContent).toBe("いま：受け渡し待ち");
    // 狭い画面でも単語の途中で折り返さない区切り
    expect([...el.querySelectorAll(".progress-step .progress-label")].map((l) => [...l.querySelectorAll(".progress-label-part")].map((p) => p.textContent)))
      .toEqual([["相談", "送信済み"], ["生産者", "回答待ち"], ["マッチ", "成立"], ["受け渡し", "待ち"]]);
    // 成立の内訳（農家・品目・数量・価格）と受け渡し
    expect([...el.querySelectorAll(".match-farms li")].map((li) => li.textContent)).toEqual(["A農園トマト 5kg・¥600/kg・小計 ¥3,000", "B農園トマト 5kg・¥600/kg・小計 ¥3,000"]);
    expect($(".match-facts")?.textContent).toContain("梅田エリア受渡所（仮）");
    await click(button("取引相談へ進む"));
    expect(el.querySelectorAll(".deal-farm")).toHaveLength(2);
    expect($(".deal-farm .deal-mail")?.textContent).toBe("A農園にメールで相談する");
    expect($(".deal-farm .deal-tel")?.getAttribute("href")).toBe("tel:00000000001");
  });
  it("詳細：一部の農家だけ対応できる相談にはマッチ成立を出さない", async () => {
    requests = [req("a", "approved"), req("b", "pending", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($(".match-banner")).toBeNull();
    expect($("main .state-tag")?.textContent).toBe("返事待ち");
    expect([...el.querySelectorAll(".progress-step")].map((s) => s.className.replace("progress-step ", ""))).toEqual(["done", "current"]); // まだ先の段階（マッチ成立・受け渡し待ち）は出さない
    expect(text()).not.toMatch(/マッチ成立|一部成立|🎉/);
    expect($("main .hint")?.textContent).toBe("「対応できます」は注文の確定ではありません。受け渡しの詳細や最終確認は、農家と直接相談して決めてください。");
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
    expect($("main .btn-primary")?.textContent).toBe("新しい仕入れ案をつくる");
  });
});

describe("生産者のホームと下部ナビの数", () => {
  beforeEach(() => { me = producer; });
  it("未対応 0：知らせもバッジも出さず、主ボタンは出品の更新", async () => {
    requests = [req("a", "approved")];
    await open("/producer/home");
    expect($(".new-requests")).toBeNull();
    expect(badge()).toBeNull();
    expect($("main .btn-primary")?.textContent).toBe("今日出せる量を更新する");
    expect(text()).toContain("トマト");
    expect(text()).toContain("8kg");
    expect($(".next-slot")?.textContent).toContain("梅田エリア受渡所（仮）");
  });
  it("未対応 1：最上部で「あなたの出品条件に合う仕入れ相談が1件あります」・バッジ 1・主ボタンは相談への返事", async () => {
    requests = [req("a", "pending")];
    await open("/producer/home");
    const notice = $(".new-requests")!;
    expect(notice.textContent).toContain("あなたの出品条件に合う仕入れ相談が1件あります");
    expect(text()).toContain("返事が必要な仕入れ相談");
    // ホームの見出しのすぐ下（出品・受渡枠より前）
    const order = [...el.querySelectorAll("main .new-requests, main #listing-title, main #slot-title")].map((x) => x.className || x.id);
    expect(order[0]).toBe("new-requests");
    expect(badge()).toBe("1");
    expect($(".bottom-nav .sr-only")?.textContent).toContain("未対応 1件");
    expect($("main .btn-primary")?.textContent).toBe("相談に返事をする");
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
    expect([...card.querySelectorAll(".request-conds li")].map((li) => li.textContent)).toEqual(["規格外可", "初めての農家可", "産地大阪府", "品種のまぜ不可", "規格のまぜ不可"]);
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
    expect($(".style-text")?.textContent).toBe("少量対応 × 直接取引の経験あり × 少量多品目");
    for (const t of ["山田 花子", "大阪府堺市南区", "トマト", "かぼちゃ", "少量多品目", "経験あり", "少量対応", "000-0000-9999"]) expect(text()).toContain(t);
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
  const posted = () => calls.filter((c) => c.url === "/api/pickup-points" && c.method === "POST").map((c) => c.body);

  it("ホーム：未登録なら「いつもの受け渡し場所：未登録」、登録済みなら場所の名前（受渡枠という言葉は出さない）", async () => {
    slots = [];
    await open("/producer/home");
    expect($(".usual-status")?.textContent).toContain("いつもの受け渡し場所：未登録");
    expect(text()).not.toContain("受渡枠");
    act(() => root?.unmount()); el.remove();
    slots = [umedaSlot];
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

  it("マイページ：いつもの場所をカードで出し、すでにある場所で「ここで渡せる」→ 曜日と時間 → 登録", async () => {
    profile = producerProfile();
    await open("/producer/mypage");
    const card = $(".usual-place")!;
    expect(card.textContent).toContain("梅田エリア受渡所（仮）");
    expect(card.textContent).toContain("火曜日 10:00〜11:00");
    await click(button("場所を追加する"));
    expect($(".ps-title")?.textContent).toBe("普段、野菜をどこで渡せますか？");
    await click(button("いつもの直売所"));
    // 直売所の候補だけ（運営の場所は「その他」に出る）
    expect([...el.querySelectorAll(".ps-place-name")].map((x) => x.textContent)).toEqual(["南区ふれあい直売所"]);
    expect($(".ps-place .ps-place-address")).toBeNull(); // 住所のない候補は住所の行を出さない
    await click(button("ここで渡せる"));
    expect($(".ps-title")?.textContent).toBe("いつ渡せますか？");
    await click(button("この場所を登録する"));
    expect(posted()).toHaveLength(0);
    expect(text()).toContain("渡せる曜日を選んでください");
    await click([...el.querySelectorAll(".ps-weekday")].find((b) => b.textContent === "金")!);
    expect($(".ps-weekday.on")?.getAttribute("aria-pressed")).toBe("true");
    await typeInto("startTime", "16:00");
    await typeInto("endTime", "15:00");
    await click(button("この場所を登録する"));
    expect(text()).toContain("終わりの時刻は、始まりより後にしてください");
    await typeInto("endTime", "18:00");
    await click(button("この場所を登録する"));
    expect(posted()).toEqual([{ placeId: "pl-store", weekday: 5, startTime: "16:00", endTime: "18:00" }]);
    expect(text()).toContain("いつもの受け渡し場所を登録しました");
    expect(text()).toContain("金曜日 16:00〜18:00");
  });

  it("はじめての出品（一般向け・場所がない）：出品の前に場所を聞き、ここにない場所も入れられる。終わると出品へ進む", async () => {
    supplyRows = [];
    slots = [];
    pickup = { ...pickup, usual: [] };
    await open("/producer/listings");
    expect($(".first-place")).not.toBeNull();
    expect($(".ps-title")?.textContent).toBe("普段、野菜をどこで渡せますか？");
    expect($("form")).toBeNull(); // 出品の入力はまだ出さない
    await click(button("その他"));
    expect([...el.querySelectorAll(".ps-place-name")].map((x) => x.textContent)).toEqual(["梅田エリア受渡所（仮）"]);
    expect($(".ps-place .ps-place-address")?.textContent).toBe("大阪市北区"); // 運営の場所は住所あり
    await click(button("ここにない場所を入れる"));
    await click(button("次へ"));
    expect(text()).toContain("場所の名前を入れてください");
    await typeInto("name", "山田農園の作業場");
    await typeInto("address", "大阪府堺市南区9-9");
    await click(button("次へ"));
    await click([...el.querySelectorAll(".ps-weekday")].find((b) => b.textContent === "土")!);
    await typeInto("startTime", "08:00");
    await typeInto("endTime", "10:00");
    await click(button("この場所を登録する"));
    await flush();
    expect(posted()).toEqual([{ name: "山田農園の作業場", address: "大阪府堺市南区9-9", kind: "other", weekday: 6, startTime: "08:00", endTime: "10:00" }]);
    expect($(".first-place")).toBeNull();
    // 出品の入力が開いていて、受け渡しはいつもの場所が選ばれている
    expect($("details.more")?.hasAttribute("open")).toBe(true);
    expect($(".pickup-current-place")?.textContent).toBe("いつもの山田農園の作業場");
    expect($('[data-field="slotId"] select')).toBeNull();
  });

  it("2回目からの出品：受け渡しは「いつもの〇〇 ✓」と日時を最初から選んでおき、「変更」で選び直せる", async () => {
    slots = [umedaSlot, { ...umedaSlot, id: "sl2", startAt: "2099-11-03T01:00:00.000Z", endAt: "2099-11-03T02:00:00.000Z" }];
    await open("/producer/listings");
    expect($(".first-place")).toBeNull();
    expect($(".pickup-current-place")?.textContent).toBe("いつもの梅田エリア受渡所（仮）");
    expect(el.querySelector(".pickup-current svg:last-child, .pickup-current-place .icon:last-child")).not.toBeNull();
    expect(text()).not.toContain("参加登録済み");
    await click($(".pickup-current .text-btn"));
    const dates = [...el.querySelectorAll('[aria-label="日時"] .pickup-option')];
    expect(dates).toHaveLength(2);
    expect(dates[0].getAttribute("aria-pressed")).toBe("true");
    await click(dates[1]);
    expect(el.querySelectorAll('[aria-label="日時"] .pickup-option')[1].getAttribute("aria-pressed")).toBe("true");
    await click(button("これにする"));
    expect($(".pickup-change")).toBeNull();
  });

  it("場所が1か所・日時が1つなら「変更」は出さない。デモ用の環境では場所を聞かない", async () => {
    await open("/producer/listings");
    expect($(".pickup-current-place")).not.toBeNull();
    expect($(".pickup-current .text-btn")).toBeNull();
    act(() => root?.unmount()); el.remove();
    mode = "demo";
    slots = [];
    await open("/producer/listings");
    expect($(".first-place")).toBeNull();
    expect(calls.some((c) => c.url === "/api/pickup-points")).toBe(false);
  });
});

describe("出品：複数の商品を1つの画面から登録（品目は候補つきの自由入力）", () => {
  beforeEach(() => { me = producer; });
  const typeInto = async (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const rowInputs = (i: number) => {
    const row = el.querySelectorAll<HTMLFieldSetElement>(".supply-new-row")[i];
    const numbers = row.querySelectorAll<HTMLInputElement>('input[type="number"]'); // 販売できる量・価格・最低販売量の順
    return { row, item: row.querySelector<HTMLInputElement>('input[list="supply-item-options"]')!, kg: numbers[0], price: numbers[1] };
  };
  const posts = () => calls.filter((c) => c.url === "/api/supplies" && c.method === "POST").map((c) => c.body as Record<string, unknown>);
  const fillRow = async (i: number, name: string, kg: string, price: string) => {
    const r = rowInputs(i);
    await typeInto(r.item, name);
    await typeInto(r.kg, kg);
    await typeInto(r.price, price);
  };
  const choosePublish = async () => { await click(el.querySelectorAll<HTMLInputElement>('input[name="pub"]')[1]); };

  it("品目は候補（既存の品目）つきの自由入力。新しい品目名には「新しい品目として登録します」", async () => {
    await open("/producer/listings");
    expect([...el.querySelectorAll("#supply-item-options option")].map((o) => o.getAttribute("value"))).toEqual(["トマト", "なす"]);
    await typeInto(rowInputs(0).item, "万願寺とうがらし");
    expect(rowInputs(0).row.textContent).toContain("新しい品目として登録します");
    await typeInto(rowInputs(0).item, "ナス"); // 表記の違いは既存の品目
    expect(rowInputs(0).row.textContent).not.toContain("新しい品目として登録します");
  });
  it("「＋ 商品を追加」で3品目を1回で登録：既存の品目は itemId、新しい品目は itemName で、1行ずつ送る", async () => {
    supplyRows = [];
    await open("/producer/listings");
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
    expect(posts().every((b) => b.slotId === "sl1" && b.originPrefecture === "大阪府" && b.published === true)).toBe(true); // 受け渡し・産地・公開は全行に共通
    expect($("details.more [role=status]")?.textContent).toContain("3件を登録しました（トマト 5kg・なす 8kg・万願寺とうがらし 3kg）");
    expect(el.querySelectorAll(".supply-new-row")).toHaveLength(1); // 終わったら1行に戻る
  });
  it("同じ画面の中で同じ品目（表記違いも含む）が2行あれば、送る前に止める", async () => {
    await open("/producer/listings");
    await click(button("商品を追加"));
    await fillRow(0, "なす", "5", "400");
    await fillRow(1, "ナス", "3", "400");
    await choosePublish();
    await click(button("2件を登録する"));
    expect(posts()).toHaveLength(0);
    expect([...el.querySelectorAll(".supply-new-row-status")].map((x) => x.textContent)).toEqual(["同じ品目がほかの行にもあります。1つの行にまとめてください", "同じ品目がほかの行にもあります。1つの行にまとめてください"]);
    expect($("details.more [role=status]")?.textContent).toContain("まだ登録していません");
  });
  it("一部だけ失敗：登録できた行は消え、できなかった行は理由（すでに出品中など）つきで残る", async () => {
    supplyPost = (b, json) => (b.itemId === "i-tomato"
      ? json({ error: "同じ品目・受渡枠の供給がすでにあります。数量の変更をご利用ください" }, 409)
      : json({ supply: { item: { name: (b.itemName as string) ?? "なす" }, availableKg: Number(b.availableKg) } }, 201));
    await open("/producer/listings");
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
    expect($("details.more [role=status]")?.textContent).toContain("1件を登録しました（水なす 2kg）。1件は登録できませんでした");
  });
  it("品目名の形が違う（記号）・空の行は送らずに理由を出す", async () => {
    await open("/producer/listings");
    await fillRow(0, "<b>", "5", "600");
    await choosePublish();
    await click(button("登録する"));
    expect(posts()).toHaveLength(0);
    expect($(".supply-new-row-status")?.textContent).toContain("記号は使えません");
  });
});
