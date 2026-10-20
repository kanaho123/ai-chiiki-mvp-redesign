// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../App";
import { EMPTY_FORM, toPlanBody, type RequestForm } from "../../lib/request-form.js";
import { wishStorageKey } from "../../lib/wishlist.js";
import { SessionProvider, type Me } from "../../routes/session";
import { clearSuggestionCache, SUGGEST_DELAY_MS } from "./ItemSuggest";

// 飲食店の「欲しい食材」の一覧（STEP 2 に置く。1行目は品目・数量の入力欄。品目＋必要量をブラウザに保存）と、品目の文字入力。
// 仕入れ案は1品目ずつ今までの流れ（/api/plan-options → /api/plan）。ブラウザから見た API の応答だけを差し替える。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const me: Me = { id: "u-r", role: "restaurant", displayName: "まちの食堂", producer: null, onboarded: true };
const formKey = `ai-chiiki:restaurant:v4:${me.id}`;
const items = [
  { id: "i-tomato", name: "トマト", varieties: [{ id: "v-tomato", name: "指定なし" }] },
  { id: "i-kyuri", name: "きゅうり", varieties: [{ id: "v-kyuri", name: "指定なし" }] },
  { id: "i-nasu", name: "なす", varieties: [{ id: "v-nasu", name: "指定なし" }] },
  { id: "i-man", name: "万願寺とうがらし", varieties: [{ id: "v-man", name: "指定なし" }] },
];
const catalog = {
  now: "2026-10-20T00:00:00.000Z", demoClock: false, aiAvailable: true, items,
  slots: [{ id: "sl1", label: "金", placeName: "梅田エリア受渡所（仮）", startAt: "2026-10-23T01:00:00.000Z", endAt: "2026-10-23T02:00:00.000Z", confirmDeadlineAt: "2026-10-22T09:00:00.000Z", feeYen: 500, feeConfirmed: true, maxKg: 50 }],
  prefectures: ["大阪府"], nearbyPrefectures: ["大阪府"], priorTradeProducers: [], producers: [],
};
// トマト10kg の条件がすべて決まっている、今までの保存データ（一覧はまだない）
const tomatoForm: RequestForm = {
  ...EMPTY_FORM, itemId: "i-tomato", quantityKg: "10", desiredDate: "2026-10-23", budgetMode: "none", originPrefectures: ["大阪府"],
  allowFirstTime: "yes", allowIrregular: "yes", allowMixedVarieties: "yes", allowMixedGrades: "yes",
};

let mode: "general" | "demo" = "general";
let calls: { url: string; method: string; body?: unknown }[] = [];
// 近い食材の候補（POST /api/item-suggestions）の応答。既定は失敗（500）
let suggestReply: (body: { name: string }) => { status: number; body: unknown } = () => ({ status: 500, body: { error: "x" } });
// AI の読み取り（POST /api/extract）の応答
let extractReply: unknown = null;
// 登録データ（GET /api/catalog）の応答を遅らせる（読み込み中に読み取りが終わる場合）
let catalogGate: Promise<void> | null = null;
beforeEach(() => {
  catalogGate = null;
  clearSuggestionCache();
  suggestReply = () => ({ status: 500, body: { error: "x" } });
  extractReply = null;
  localStorage.clear();
  mode = "general";
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ user: me, demoNow: null, appMode: mode });
    if (url === "/api/inbox") return json({ producerRequests: 0 });
    if (url === "/api/catalog") { if (catalogGate) await catalogGate; return json(catalog); }
    if (url === "/api/plan-options") return json({ options: [] });
    if (url === "/api/item-suggestions") { const r = suggestReply(body as { name: string }); return json(r.body, r.status); }
    if (url === "/api/extract" && extractReply) return json(extractReply);
    return json({ error: "not found" }, 404);
  }));
});

let root: Root | null = null;
let el: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  vi.unstubAllGlobals();
});
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function open() {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => { root!.render(<SessionProvider><MemoryRouter initialEntries={["/restaurant/buy"]}><AppRoutes /></MemoryRouter></SessionProvider>); });
  await flush();
}
const text = () => el.textContent ?? "";
const click = async (node: Element | null | undefined) => { expect(node).toBeTruthy(); await act(async () => { (node as HTMLElement).click(); }); await flush(); };
const button = (label: string, scope: ParentNode = el) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(label));
const typeInto = async (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const rows = () => [...el.querySelectorAll<HTMLLIElement>(".wish-row")]; // ほかの食材（2行目以降）
const row = (i: number) => ({ li: rows()[i], name: rows()[i].querySelector<HTMLInputElement>('input.wish-item')!, kg: rows()[i].querySelector<HTMLInputElement>('input[type="number"]')! });
const fillRow = async (i: number, name: string, kg: string) => { await typeInto(row(i).name, name); await typeInto(row(i).kg, kg); };
const itemInput = () => el.querySelector<HTMLInputElement>("input.item-text")!;
const qtyInput = () => el.querySelector<HTMLInputElement>('input[aria-label="数量（kg）"]')!;
const fillFirst = async (name: string, kg: string) => { await typeInto(itemInput(), name); await typeInto(qtyInput(), kg); };
const cta = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent?.trim();
const stored = () => JSON.parse(localStorage.getItem(wishStorageKey(me.id)) ?? "null");
const waitSuggest = async () => { await act(async () => { await new Promise((r) => setTimeout(r, SUGGEST_DELAY_MS + 100)); }); await flush(); };
const suggestCalls = () => calls.filter((c) => c.url === "/api/item-suggestions");
const planCalls = () => calls.filter((c) => c.url === "/api/plan-options" || c.url === "/api/plan");
const writeText = async (v: string) => {
  const ta = el.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, v);
  await act(async () => { ta.dispatchEvent(new Event("input", { bubbles: true })); });
};
const nullExtracted = { itemText: null, varietyText: null, quantityKg: null, dateText: null, budgetYen: null, budgetIncludesHandoverFee: null, budgetUnlimited: null, originText: null, handoverText: null, preferredProducerText: null, producerRequired: null, allowFirstTime: null, allowIrregular: null, allowMixedVarieties: null, allowMixedGrades: null };
const nullDraft = { itemId: null, varietyId: null, quantityKg: null, desiredDate: null, budget: null, originPrefectures: [], slotId: null, allowFirstTime: null, allowIrregular: null, allowMixedVarieties: null, allowMixedGrades: null, preferredProducerId: null };
const kurokyabetsu = {
  extracted: { ...nullExtracted, itemText: "黒キャベツ", quantityKg: 3 }, draft: { ...nullDraft, quantityKg: 3 },
  unresolvedFields: ["itemId"], candidateMatches: {}, notices: ["ITEM_NOT_FOUND"],
};

describe("STEP 1（一般向けの環境）：入力例は1つだけ。一覧・✓の表示は出さない", () => {
  it("「入力例：トマト10kg 大阪産 10/23午前」と「例文を入力」（押すと例文がそのまま入る）。食材の一覧はない", async () => {
    await open();
    expect(text()).toContain("入力例：トマト10kg 大阪産 10/23午前");
    expect(el.querySelector(".hint-tiles")).toBeNull();
    expect(el.querySelector(".wish-section, .wish-row")).toBeNull();
    await click(button("例文を入力"));
    expect(el.querySelector("textarea")!.value).toBe("トマト10kg 大阪産 10/23午前");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]); // 入れるだけで AI は呼ばない
  });
});

describe("STEP 2 の「欲しい食材」（一般向けの環境）", () => {
  it("1行目は品目・数量の入力欄。「＋ 食材を追加」でほかの食材を並べ、ブラウザに保存する（開き直しても残る）", async () => {
    await open();
    await click(button("項目で入力"));
    expect(el.querySelector(".wish-section")?.textContent).toContain("欲しい食材");
    // 品目は普通の文字入力（登録品目の一覧・▼は出さない）
    expect(el.querySelector("datalist")).toBeNull();
    expect(itemInput().getAttribute("list")).toBeNull();
    expect(itemInput().placeholder).toBe("例：キャベツ、万願寺とうがらし");
    expect(rows()).toHaveLength(0);
    expect(text()).not.toContain("仕入れ案は1品目ずつ確認します");
    await fillFirst("トマト", "10");
    expect(cta()).toBe("仕入れ案を見る"); // 1品目だけ
    await click(button("食材を追加"));
    await fillRow(0, "きゅうり", "5");
    await click(button("食材を追加"));
    await fillRow(1, "万願寺とうがらし", "2");
    expect(text()).toContain("仕入れ案は1品目ずつ確認します");
    expect(cta()).toBe("トマトの仕入れ案を見る");
    expect(stored()).toMatchObject({ v: 1, rows: [{ name: "トマト", kg: "10" }, { name: "きゅうり", kg: "5" }, { name: "万願寺とうがらし", kg: "2" }] });
    expect(stored().active).toBe(stored().rows[0].id);
    act(() => root?.unmount());
    el.remove();
    await open();
    expect(text()).toContain("この内容で合っていますか？");
    expect([itemInput().value, qtyInput().value]).toEqual(["トマト", "10"]);
    expect(rows().map((_, i) => [row(i).name.value, row(i).kg.value])).toEqual([["きゅうり", "5"], ["万願寺とうがらし", "2"]]);
    expect(planCalls()).toEqual([]); // 並べるだけでは計算しない
    expect(el.querySelector(".wish-switch")).toBeNull(); // 切り替えは仕入れ案の画面だけ
  });

  it("空の行が増えても、ボタンは「仕入れ案を見る」のまま。行は「消す」で消せる", async () => {
    await open();
    await click(button("項目で入力"));
    await fillFirst("トマト", "10");
    await click(button("食材を追加"));
    expect(cta()).toBe("仕入れ案を見る");
    await click(button("消す", row(0).li));
    expect(rows()).toHaveLength(0);
    expect(stored().rows).toHaveLength(1);
  });

  it("「この食材を確認する」で、その食材が1行目（品目・数量）になり、ボタンもその品目になる。もとの食材はほかの食材に残る", async () => {
    await open();
    await click(button("項目で入力"));
    await fillFirst("トマト", "10");
    await click(button("食材を追加"));
    await fillRow(0, "きゅうり", "5");
    await click(button("この食材を確認する", row(0).li));
    expect([itemInput().value, qtyInput().value]).toEqual(["きゅうり", "5"]);
    expect(cta()).toBe("きゅうりの仕入れ案を見る");
    expect(rows().map((_, i) => [row(i).name.value, row(i).kg.value])).toEqual([["トマト", "10"]]);
    expect(stored().active).toBe(stored().rows[1].id);
    expect(planCalls()).toEqual([]);
  });

  it("出品のない品目（黒キャベツ）の行を確認すると、品目欄に名前を残して「いま、この品目の出品はありません」（品目は作らない）", async () => {
    await open();
    await click(button("項目で入力"));
    await fillFirst("トマト", "10");
    await click(button("食材を追加"));
    await fillRow(0, "黒キャベツ", "3");
    await click(button("この食材を確認する", row(0).li));
    expect(itemInput().value).toBe("黒キャベツ");
    await waitSuggest(); // 近い食材の候補を取れなかった（既定は失敗）
    expect(text()).toContain("いま、この品目の出品はありません");
    expect(el.querySelector(".alert.bad")).toBeNull(); // エラーの表示にしない
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual(["/api/item-suggestions"]); // 読み取りだけ
    await typeInto(itemInput(), "ナス"); // 表記の違いは登録済みの品目
    expect(text()).toContain("「なす」で探します");
    expect(stored().rows.find((w: { id: string }) => w.id === stored().active).name).toBe("ナス");
  });

  it("トマト 10kg だけなら、今までと同じ条件で同じ計算を呼ぶ（一覧があっても送る内容は変わらない）", async () => {
    localStorage.setItem(formKey, JSON.stringify({ step: "input", text: "", form: tomatoForm, shown: null }));
    await open();
    await click(button("項目で入力"));
    expect([itemInput().value, qtyInput().value]).toEqual(["トマト", "10"]); // 今までの保存データから1行目を作る
    expect(cta()).toBe("仕入れ案を見る");
    await act(async () => { el.querySelector("form")!.requestSubmit(); });
    await flush();
    expect(planCalls()).toEqual([{ url: "/api/plan-options", method: "POST", body: toPlanBody(tomatoForm) }]);
  });
});

describe("STEP 1 → 2：AI の値はフォームに入れるだけ（別に並べない）", () => {
  const tomato = {
    extracted: { ...nullExtracted, itemText: "トマト", quantityKg: 10, originText: "大阪", dateText: "10/23" },
    draft: { ...nullDraft, itemId: "i-tomato", quantityKg: 10, desiredDate: "2026-10-23", originPrefectures: ["大阪府"] },
    unresolvedFields: [], candidateMatches: {}, notices: [],
  };
  it("「AIが入力内容を整理しました。必要なら修正できます。」と、AI の値が入った入力欄だけ。読み取り件数は出さない", async () => {
    extractReply = tomato;
    await open();
    await click(button("例文を入力"));
    await click(button("条件を整理する"));
    expect(text()).toContain("AIが入力内容を整理しました。必要なら修正できます。");
    expect(text()).not.toContain("項目を読み取りました");
    expect([itemInput().value, qtyInput().value]).toEqual(["トマト", "10"]);
    expect(stored().rows).toMatchObject([{ name: "トマト", kg: "10" }]);
    expect(cta()).toBe("仕入れ案を見る");
  });
  it("登録データの読み込みより先に読み取りが終わっても、1行目の名前は読み取った品目になる", async () => {
    extractReply = tomato;
    let release!: () => void;
    catalogGate = new Promise((r) => { release = r; });
    localStorage.setItem(wishStorageKey(me.id), JSON.stringify({ v: 1, rows: [{ id: "w1", name: "", kg: "" }], active: "w1" })); // 一覧はもうある
    await open();
    await click(button("例文を入力"));
    await click(button("条件を整理する"));
    await act(async () => { release(); });
    await flush();
    expect([itemInput().value, qtyInput().value]).toEqual(["トマト", "10"]);
    expect(stored().rows).toMatchObject([{ name: "トマト", kg: "10" }]);
  });
  it("一覧にほかの食材があるときは、読み取った食材を1行目にして、ほかの食材は残す（同じ食材の行は使い回す）", async () => {
    extractReply = tomato;
    await open();
    await click(button("項目で入力"));
    await fillFirst("きゅうり", "5");
    await click(button("食材を追加"));
    await fillRow(0, "トマト", "3");
    await click(button("文章の入力に戻る"));
    await writeText("トマト10kg");
    await click(button("条件を整理する"));
    expect([itemInput().value, qtyInput().value]).toEqual(["トマト", "10"]);
    expect(rows().map((_, i) => [row(i).name.value, row(i).kg.value])).toEqual([["きゅうり", "5"]]);
    expect(stored().rows).toHaveLength(2);
    expect(cta()).toBe("トマトの仕入れ案を見る");
  });
});

describe("登録されていない品目：近い食材の候補（いま出品されている品目から・押したときだけ切り替える）", () => {
  const near = () => ({ status: 200, body: { match: null, suggestions: [{ id: "i-nasu", name: "なす" }, { id: "i-kyuri", name: "きゅうり" }], ai: "ok" } });

  it("品目欄：「黒キャベツは現在ありません」と近い食材。押すまで書いた名前は変わらず、押すとその品目になる（一覧の1行目も）", async () => {
    suggestReply = near;
    await open();
    await click(button("項目で入力"));
    await fillFirst("黒キャベツ", "3");
    expect(text()).toContain("近い食材を探しています");
    await waitSuggest();
    expect(suggestCalls().map((c) => c.body)).toEqual([{ name: "黒キャベツ", desiredDate: null, slotId: null }]);
    expect(text()).toContain("黒キャベツは現在ありません");
    expect([...el.querySelectorAll(".item-alts-chips button")].map((b) => b.textContent)).toEqual(["なす", "きゅうり"]);
    expect(itemInput().value).toBe("黒キャベツ"); // 勝手に置き換えない
    expect(text()).not.toContain("受け取り可否は選択後に確認します"); // 条件に合う品目から見つけた候補には添えない
    await click(button("なす"));
    expect(itemInput().value).toBe("なす");
    expect(stored().rows[0]).toMatchObject({ name: "なす", kg: "3" });
    expect(planCalls()).toEqual([]);
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual(["/api/item-suggestions"]);
  });

  it("希望の受け取り条件では出品がない候補（conditionAvailable: false）にだけ「受け取り可否は選択後に確認します」と添える。押すまで変えない", async () => {
    suggestReply = () => ({ status: 200, body: { match: null, ai: "ok", suggestions: [{ id: "i-kyuri", name: "きゅうり", conditionAvailable: true }, { id: "i-nasu", name: "なす", conditionAvailable: false }] } });
    await open();
    await click(button("項目で入力"));
    await fillFirst("キャベツ", "2");
    await waitSuggest();
    expect(text()).toContain("キャベツは現在ありません");
    const chip = (n: string) => [...el.querySelectorAll(".item-alts-chips button")].find((b) => b.textContent?.startsWith(n))!;
    expect(chip("なす").querySelector(".item-alts-note")?.textContent).toBe("受け取り可否は選択後に確認します");
    expect(chip("きゅうり").querySelector(".item-alts-note")).toBeNull(); // 条件内の候補は通常の表示
    expect(el.querySelectorAll(".item-alts-note")).toHaveLength(1);
    expect(itemInput().value).toBe("キャベツ");
    await click(button("なす"));
    expect(itemInput().value).toBe("なす");
    expect(planCalls()).toEqual([]); // 仕入れられるかは、今までどおり「仕入れ案を見る」のあとに計算する
  });

  it("登録済みの品目（キュウリ）は候補を探さない（AI を呼ばない）", async () => {
    await open();
    await click(button("項目で入力"));
    await fillFirst("キュウリ", "5");
    await waitSuggest();
    expect(suggestCalls()).toEqual([]);
    expect(text()).toContain("「きゅうり」で探します");
  });

  it("文章入力：「黒キャベツ」と書いた内容は確認の画面の品目欄に残り、「一覧から選んでください」で止まらず、近い食材を出す", async () => {
    suggestReply = near;
    extractReply = kurokyabetsu;
    await open();
    await writeText("黒キャベツを3kg");
    await click(button("条件を整理する"));
    expect(text()).toContain("この内容で合っていますか？");
    expect(itemInput().value).toBe("黒キャベツ"); // 書いた内容が消えない
    expect(stored().rows[0]).toMatchObject({ name: "黒キャベツ", kg: "3" });
    expect(text()).not.toContain("一覧から選んでください");
    await waitSuggest();
    expect(text()).toContain("黒キャベツは現在ありません");
    expect(itemInput().value).toBe("黒キャベツ");
    await click(button("きゅうり"));
    expect(itemInput().value).toBe("きゅうり");
    expect(text()).not.toContain("黒キャベツは現在ありません");
    expect(planCalls()).toEqual([]); // 品目を選んだだけでは計算しない
  });

  it("候補を取れない（AI の失敗など）：「いま、この品目の出品はありません」だけで、画面は壊れない", async () => {
    await open();
    await click(button("項目で入力"));
    await typeInto(itemInput(), "黒キャベツ");
    await waitSuggest();
    expect(text()).toContain("いま、この品目の出品はありません");
    expect(text()).not.toContain("近い食材");
    expect(el.querySelector(".alert.bad")).toBeNull();
    expect(text()).toContain("あと"); // 品目は未選択のまま
  });
});

describe("今までの保存データ・壊れた保存データでも画面が壊れない", () => {
  it("条件の確認の途中だった保存データ（一覧なし）：そのまま確認の画面を開き、一覧は入力中の品目から作る", async () => {
    localStorage.setItem(formKey, JSON.stringify({ step: "confirm", text: "トマト10kg", form: tomatoForm, shown: null }));
    await open();
    expect(text()).toContain("この内容で合っていますか？");
    expect(stored()).toMatchObject({ v: 1, rows: [{ name: "トマト", kg: "10" }] });
    expect(itemInput().value).toBe("トマト");
  });
  it("一覧の保存データが壊れている・版が違う：空の1行から始める", async () => {
    for (const bad of ["{oops", JSON.stringify({ v: 99, rows: [{ name: "トマト" }] }), JSON.stringify({ v: 1, rows: [null, 3] })]) {
      localStorage.clear();
      localStorage.setItem(wishStorageKey(me.id), bad);
      await open();
      await click(button("項目で入力"));
      expect(itemInput().value).toBe("");
      expect(rows()).toHaveLength(0);
      expect(stored().rows).toHaveLength(1);
      act(() => root?.unmount());
      el.remove();
    }
  });
});

describe("デモ用の環境は今までどおり", () => {
  it("一覧・入力例は出さず、品目は今までの選択肢。ボタンは「この条件で仕入れ案を見る」", async () => {
    mode = "demo";
    await open();
    expect(el.querySelector(".hint-tiles")).toBeTruthy();
    expect(text()).not.toContain("入力例：");
    await click(button("項目で入力"));
    expect(el.querySelector(".wish-section")).toBeNull();
    expect(el.querySelector('select[aria-label="品目"]')).toBeTruthy();
    expect(el.querySelector("input.item-text")).toBeNull();
    expect(cta()).toBe("この条件で仕入れ案を見る");
    expect(localStorage.getItem(wishStorageKey(me.id))).toBeNull();
    expect(suggestCalls()).toEqual([]);
  });
  it("文章入力で品目が見つからないときも、今までどおり「一覧から選んでください」と選択肢・読み取り件数（候補は探さない）", async () => {
    mode = "demo";
    extractReply = kurokyabetsu;
    await open();
    await writeText("黒キャベツを3kg");
    await click(button("条件を整理する"));
    expect(text()).toContain("品目が登録データに見つかりませんでした。一覧から選んでください");
    expect(text()).toContain("項目を読み取りました");
    expect(text()).not.toContain("AIが入力内容を整理しました");
    expect(el.querySelector('select[aria-label="品目"]')).toBeTruthy();
    await waitSuggest();
    expect(suggestCalls()).toEqual([]);
  });
});
