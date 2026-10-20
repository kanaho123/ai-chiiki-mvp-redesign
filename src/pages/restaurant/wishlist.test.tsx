// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../App";
import { EMPTY_FORM, toPlanBody, type RequestForm } from "../../lib/request-form.js";
import { wishStorageKey } from "../../lib/wishlist.js";
import { SessionProvider, type Me } from "../../routes/session";

// 飲食店の「欲しい食材」の一覧（品目＋必要量・ブラウザに保存）と、条件の確認の品目の文字入力。
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
beforeEach(() => {
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
    if (url === "/api/catalog") return json(catalog);
    if (url === "/api/plan-options") return json({ options: [] });
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
const rows = () => [...el.querySelectorAll<HTMLLIElement>(".wish-row")];
const row = (i: number) => ({ li: rows()[i], name: rows()[i].querySelector<HTMLInputElement>('input[list="wish-item-options"]')!, kg: rows()[i].querySelector<HTMLInputElement>('input[type="number"]')! });
const fillRow = async (i: number, name: string, kg: string) => { await typeInto(row(i).name, name); await typeInto(row(i).kg, kg); };
const stored = () => JSON.parse(localStorage.getItem(wishStorageKey(me.id)) ?? "null");
const planCalls = () => calls.filter((c) => c.url === "/api/plan-options" || c.url === "/api/plan");

describe("欲しい食材の一覧（一般向けの環境）", () => {
  it("トマト 10kg・きゅうり 5kg・万願寺とうがらし 2kg を「＋ 食材を追加」で並べ、ブラウザに保存する（開き直しても残る）", async () => {
    await open();
    expect(el.querySelector(".wish-card")).toBeTruthy();
    expect([...el.querySelectorAll("#wish-item-options option")].map((o) => o.getAttribute("value"))).toEqual(items.map((i) => i.name));
    await fillRow(0, "トマト", "10");
    await click(button("食材を追加"));
    await fillRow(1, "きゅうり", "5");
    await click(button("食材を追加"));
    await fillRow(2, "万願寺とうがらし", "2");
    expect(stored()).toMatchObject({ v: 1, rows: [{ name: "トマト", kg: "10" }, { name: "きゅうり", kg: "5" }, { name: "万願寺とうがらし", kg: "2" }] });
    act(() => root?.unmount());
    el.remove();
    await open();
    expect(rows().map((_, i) => [row(i).name.value, row(i).kg.value])).toEqual([["トマト", "10"], ["きゅうり", "5"], ["万願寺とうがらし", "2"]]);
    expect(planCalls()).toEqual([]); // 並べるだけでは計算しない
  });

  it("出品のない品目（黒キャベツ）は「いま、この品目の出品はありません」を通常の表示で出し、仕入れ案は開けない。品目を作る通信もしない", async () => {
    await open();
    await fillRow(0, "黒キャベツ", "3");
    expect(row(0).li.textContent).toContain("いま、この品目の出品はありません");
    expect(el.querySelector(".alert.bad")).toBeNull(); // エラーの表示にしない
    expect(button("仕入れ案を見る", row(0).li)!.disabled).toBe(true);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    await typeInto(row(0).name, "ナス"); // 表記の違いは登録済みの品目
    expect(row(0).li.textContent).toContain("「なす」で探します");
    expect(button("仕入れ案を見る", row(0).li)!.disabled).toBe(false);
  });

  it("各行から別々に、その品目の条件の確認へ進める（品目と必要量が入る）。上の切り替えでほかの品目へ移れる", async () => {
    await open();
    await fillRow(0, "トマト", "10");
    await click(button("食材を追加"));
    await fillRow(1, "きゅうり", "5");
    await click(button("仕入れ案を見る", row(1).li));
    expect(text()).toContain("この内容で合っていますか？");
    expect(el.querySelector<HTMLInputElement>('input[list="plan-item-options"]')?.value ?? "").toBe(""); // 品目は決まっているのでタイル
    expect(text()).toContain("きゅうり");
    expect(text()).toContain("5kg");
    const chips = () => [...el.querySelectorAll(".wish-switch .wish-chip")];
    expect(chips().map((c) => c.textContent)).toEqual(["トマト 10kg", "きゅうり 5kg"]);
    expect(el.querySelector(".wish-switch [aria-current]")?.textContent).toBe("きゅうり 5kg");
    await click(button("トマト 10kg"));
    expect(el.querySelector(".wish-switch [aria-current]")?.textContent).toBe("トマト 10kg");
    expect(text()).toContain("10kg");
    expect(stored().active).toBe(stored().rows[0].id);
    await click(button("一覧"));
    expect(el.querySelector(".wish-card")).toBeTruthy();
  });

  it("トマト 10kg だけなら、今までと同じ条件で同じ計算を呼ぶ（一覧を通っても送る内容は変わらない）", async () => {
    localStorage.setItem(formKey, JSON.stringify({ step: "input", text: "", form: tomatoForm, shown: null }));
    await open();
    expect([row(0).name.value, row(0).kg.value]).toEqual(["トマト", "10"]); // 今までの保存データから1行目を作る
    await click(button("仕入れ案を見る", row(0).li));
    expect(el.querySelector(".wish-switch")).toBeNull(); // 1品目だけなら切り替えは出さない
    await act(async () => { el.querySelector("form")!.requestSubmit(); });
    await flush();
    expect(planCalls()).toEqual([{ url: "/api/plan-options", method: "POST", body: toPlanBody(tomatoForm) }]);
  });
});

describe("今までの保存データ・壊れた保存データでも画面が壊れない", () => {
  it("条件の確認の途中だった保存データ（一覧なし）：そのまま確認の画面を開き、一覧は入力中の品目から作る", async () => {
    localStorage.setItem(formKey, JSON.stringify({ step: "confirm", text: "トマト10kg", form: tomatoForm, shown: null }));
    await open();
    expect(text()).toContain("この内容で合っていますか？");
    expect(stored()).toMatchObject({ v: 1, rows: [{ name: "トマト", kg: "10" }] });
  });
  it("一覧の保存データが壊れている・版が違う：空の1行から始める", async () => {
    for (const bad of ["{oops", JSON.stringify({ v: 99, rows: [{ name: "トマト" }] }), JSON.stringify({ v: 1, rows: [null, 3] })]) {
      localStorage.clear();
      localStorage.setItem(wishStorageKey(me.id), bad);
      await open();
      expect(rows()).toHaveLength(1);
      expect(row(0).name.value).toBe("");
      act(() => root?.unmount());
      el.remove();
    }
  });
});

describe("条件の確認：品目は候補つきの文字入力（登録済みの品目だけ・品目は作らない）", () => {
  it("書いた名前を登録済みの品目に照らす。ない品目は「いま、この品目の出品はありません」で、品目は未選択のまま", async () => {
    await open();
    await click(button("項目で入力"));
    const input = el.querySelector<HTMLInputElement>('input[list="plan-item-options"]')!;
    expect(input).toBeTruthy();
    await typeInto(input, "黒キャベツ");
    expect(text()).toContain("いま、この品目の出品はありません");
    expect(text()).toContain("あと"); // 品目は未選択のまま
    await typeInto(input, "万願寺とうがらし");
    expect(text()).not.toContain("いま、この品目の出品はありません");
    await typeInto(input, "トマト");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("デモ用の環境は今までどおり", () => {
  it("一覧は出さず、品目は今までの選択肢", async () => {
    mode = "demo";
    await open();
    expect(el.querySelector(".wish-card")).toBeNull();
    await click(button("項目で入力"));
    expect(el.querySelector('select[aria-label="品目"]')).toBeTruthy();
    expect(el.querySelector('input[list="plan-item-options"]')).toBeNull();
    expect(localStorage.getItem(wishStorageKey(me.id))).toBeNull();
  });
});
