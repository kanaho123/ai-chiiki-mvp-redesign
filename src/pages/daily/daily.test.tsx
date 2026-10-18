// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
beforeEach(() => {
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
    if (url === "/api/supplies") return json({
      supplies: [{ id: "sp1", item: { name: "トマト" }, variety: { name: "指定なし" }, availableKg: 8, priceYenPerKg: 600, published: true, slot: { label: "梅田・火", placeName: "梅田", startAt: "2026-10-27T01:00:00.000Z", endAt: "2026-10-27T02:00:00.000Z" } }],
      slots: [{ id: "sl1", label: "梅田・火", placeName: "梅田エリア受渡所（仮）", startAt: "2099-10-27T01:00:00.000Z", endAt: "2099-10-27T02:00:00.000Z" }],
    });
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
    await click(button("取引相談へ進む"));
    expect(el.querySelectorAll(".deal-farm")).toHaveLength(2);
    expect($(".deal-farm .deal-mail")?.textContent).toBe("A農園にメールで相談する");
    expect($(".deal-farm .deal-tel")?.getAttribute("href")).toBe("tel:00000000001");
  });
  it("詳細：一部の農家だけ対応できる相談にはマッチ成立を出さない", async () => {
    requests = [req("a", "approved"), req("b", "pending", { producerName: "B農園" })];
    await open("/restaurant/consultations/fp-1");
    expect($(".match-banner")).toBeNull();
    expect(text()).not.toContain("マッチ成立");
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
    for (const t of ["山田 花子", "大阪府堺市南区", "トマト", "かぼちゃ", "少量多品目", "経験あり", "少量対応", "梅田エリア受渡所（仮）（毎週火曜日 10:00〜11:00）", "000-0000-9999"]) expect(text()).toContain(t);
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
