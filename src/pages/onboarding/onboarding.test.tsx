// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../../App";
import { SessionProvider, type Me } from "../../routes/session";

// 初回登録の画面のテスト（画面の動き）。ブラウザから見た API の応答だけを差し替える。
// サーバー側の確認・保存は server/onboarding-api.test.ts で本物の処理を使って確かめている。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

let me: Me;
let posted: { url: string; body: Record<string, unknown> }[] = [];
let postResponse: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: {} });
const MASTER = {
  items: [{ id: "i-tomato", name: "トマト" }, { id: "i-eggplant", name: "なす" }, { id: "i-onion", name: "玉ねぎ" }],
  series: [
    { id: "s-umeda", placeName: "梅田エリア受渡所（仮）", placeAddress: "大阪市北区", weekday: 2, startTime: "10:00", endTime: "11:00", feeYen: 800 },
    { id: "s-tennoji", placeName: "天王寺エリア受渡所（仮）", placeAddress: "大阪市天王寺区", weekday: 3, startTime: "14:00", endTime: "15:00", feeYen: 800 },
  ],
};

beforeEach(() => {
  sessionStorage.clear();
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ user: me, demoNow: null, appMode: "general" });
    if (url.startsWith("/api/onboarding/master")) return json(MASTER);
    if (init?.method === "POST" && url.startsWith("/api/onboarding/")) {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      const r = postResponse(url);
      if (r.status === 200) me = { ...me, onboarded: true, displayName: String(posted.at(-1)!.body.name ?? posted.at(-1)!.body.farmName) };
      return json(r.body, r.status);
    }
    if (url.startsWith("/api/auth/logout")) return json({});
    return json({ error: "not found" }, 404);
  }));
  postResponse = () => ({ status: 200, body: { status: "completed", user: null } });
});

let root: Root | null = null;
let el: HTMLDivElement;
let nav: NavigateFunction;
let path = "";
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  vi.unstubAllGlobals();
});

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function open(at: string) {
  function Probe() {
    path = useLocation().pathname;
    nav = useNavigate();
    return null;
  }
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(<SessionProvider><MemoryRouter initialEntries={[at]}><AppRoutes /><Probe /></MemoryRouter></SessionProvider>);
  });
  await flush(6);
}
const $ = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel);
const h1 = () => $("main h1")?.textContent ?? "";
async function type(name: string, value: string) {
  const input = $<HTMLInputElement>(`input[name="${name}"]`)!;
  expect(input, name).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function choose(name: string, value: string) {
  const s = $<HTMLSelectElement>(`select[name="${name}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(s, value);
  await act(async () => { s.dispatchEvent(new Event("change", { bubbles: true })); });
}
/** 選択肢を文字で探して押す */
async function pick(name: string, label: string) {
  const card = [...el.querySelectorAll<HTMLLabelElement>(`label.option-card`)].find((l) => l.querySelector(`input[name="${name}"]`) && l.querySelector("b")?.textContent === label);
  expect(card, `${name}:${label}`).toBeTruthy();
  await act(async () => { card!.querySelector("input")!.click(); });
}
const checked = (name: string) => [...el.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((i) => i.closest("label")!.querySelector("b")!.textContent);
const errorsShown = () => [...el.querySelectorAll(".field-error")].map((e) => e.textContent);
async function next() {
  await act(async () => { $<HTMLButtonElement>(".bottom-bar button[type=submit]")!.click(); });
  await flush(3);
}
async function back() {
  await act(async () => { $<HTMLButtonElement>(".onb-back")!.click(); });
  await flush(2);
}

describe("飲食店の初回登録（4 STEP）", () => {
  beforeEach(() => { me = { id: "u-r", role: "restaurant", displayName: "（未設定）", producer: null, onboarded: false }; });

  it("入力 → 確認 → 完了 → ホーム。途中で戻っても値は残る", async () => {
    await open("/onboarding/restaurant");
    expect(path).toBe("/onboarding/restaurant/1");
    expect($(".bottom-nav")).toBeNull();
    expect($(".flow-count")?.textContent).toBe("1 / 4");
    expect($(".onb-back")).toBeNull(); // 最初の STEP には戻る先がない

    // 何も入れずに次へ → 各項目の近くに誤り・先へ進まない
    await next();
    expect(path).toBe("/onboarding/restaurant/1");
    expect(errorsShown()).toEqual(expect.arrayContaining(["店舗名を入力してください", "業態を選んでください", "都道府県を選んでください", "市区町村を入力してください"]));

    await type("name", "まちの食堂");
    await pick("businessType", "その他");
    await next();
    expect(errorsShown()).toContain("業態を入力してください"); // その他のときだけ内容が必要
    await type("businessTypeOther", "定食屋");
    await choose("prefecture", "大阪府");
    await type("city", "大阪市北区");
    expect(errorsShown()).toEqual([]); // 直した項目の誤りは消える
    await next();
    expect(path).toBe("/onboarding/restaurant/2");
    expect($(".flow-count")?.textContent).toBe("2 / 4");

    await pick("purchaseFrequency", "週2〜3回");
    await pick("purchaseVolume", "少量中心");
    await next();
    expect(path).toBe("/onboarding/restaurant/3");

    await pick("irregularPolicy", "積極的に使いたい");
    await pick("firstTimePolicy", "新しい農家も候補に入れる");
    await pick("pickupTimes", "午前");
    await pick("pickupTimes", "特にこだわらない"); // ほかの時間帯とは同時に選べない
    expect(checked("pickupTimes")).toEqual(["特にこだわらない"]);
    await pick("pickupTimes", "早朝");
    expect(checked("pickupTimes")).toEqual(["早朝"]);
    // 大切にしたいこと：3つまで。4つ目はその場で理由を出す
    for (const l of ["地元・近さ", "鮮度", "価格"]) await pick("priorities", l);
    await pick("priorities", "珍しい食材");
    expect(checked("priorities")).toEqual(["地元・近さ", "鮮度", "価格"]);
    expect($(".limit-note")?.textContent).toContain("3つまで選べます");
    expect($(".choice-count")?.textContent).toBe("3 / 3 選択中");
    await pick("priorities", "価格"); // 外す
    expect($(".limit-note")).toBeNull();

    // 戻る → 前の STEP の値が残っている
    await back();
    expect(path).toBe("/onboarding/restaurant/2");
    expect(checked("purchaseFrequency")).toEqual(["週2〜3回"]);
    await back();
    expect(($<HTMLInputElement>('input[name="name"]'))!.value).toBe("まちの食堂");
    expect(($<HTMLInputElement>('input[name="businessTypeOther"]'))!.value).toBe("定食屋");
    await next();
    await next();
    expect(checked("priorities")).toEqual(["地元・近さ", "鮮度"]);
    await next();
    expect(path).toBe("/onboarding/restaurant/4");

    // 確認：あなたの仕入れスタイル（選んだ内容から決まった規則で）
    expect(h1()).toBe("あなたの仕入れスタイル");
    expect($(".style-text")?.textContent).toBe("地元産 × 鮮度重視 × 少量仕入れ");
    expect($(".summary-rows")?.textContent).toContain("まちの食堂（定食屋）");
    const cta = $<HTMLButtonElement>(".bottom-bar button[type=submit]")!;
    expect(cta.textContent).toBe("この内容ではじめる");
    expect(el.querySelectorAll(".bottom-bar button")).toHaveLength(1);

    await next();
    await flush(4);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("/api/onboarding/restaurant");
    expect(posted[0].body).toMatchObject({ name: "まちの食堂", businessType: "other", businessTypeOther: "定食屋", pickupTimes: ["early_morning"], priorities: ["local", "freshness"] });
    expect(path).toBe("/restaurant/home");
    expect($(".bottom-nav")).not.toBeNull();
    expect($("[role=status]")?.textContent).toContain("登録が完了しました");
    expect(Object.keys(sessionStorage).filter((k) => k.includes(":v1:"))).toEqual([]); // 入力途中の内容は消す

    // 完了後に登録画面を開いてもホームへ
    await act(async () => nav("/onboarding/restaurant/2"));
    await flush(2);
    expect(path).toBe("/restaurant/home");
  });

  it("受け取りの時間帯・大切にしたいことは選ばなくても登録できる（空の配列で送る）。要約は必須の回答から作る", async () => {
    sessionStorage.setItem("ai-chiiki:onboarding:v1:u-r:restaurant", JSON.stringify({
      name: "店", businessType: "cafe", prefecture: "京都府", city: "京都市", purchaseFrequency: "weekly", purchaseVolume: "kg10_30",
    }));
    await open("/onboarding/restaurant/3");
    expect(el.textContent).toContain("選ばなくても登録できます");
    expect(el.textContent).not.toContain("仕入れ案をつくるときの参考");
    const tags = [...el.querySelectorAll("fieldset[data-field=pickupTimes] .tag-opt, fieldset[data-field=priorities] .tag-opt")].map((t) => t.textContent);
    expect(tags).toEqual(["任意", "任意"]);
    await pick("irregularPolicy", "条件による");
    await pick("firstTimePolicy", "取引経験のある農家を優先したい");
    await next();
    expect(path).toBe("/onboarding/restaurant/4");
    expect($(".style-text")?.textContent).toBe("1回10〜30kg × なじみの農家優先 × 週1回仕入れ");
    expect($(".summary-rows")?.textContent).toContain("選んでいません");
    expect(el.textContent).toContain("今は入力しなくても登録できます");
    expect(el.textContent).not.toContain("マイページ");
    await next();
    await flush(4);
    expect(posted[0].body).toMatchObject({ pickupTimes: [], priorities: [] });
    expect(path).toBe("/restaurant/home");
  });

  it("STEP1 の住所・電話番号は、今は入力しなくても登録できると分かる（マイページへの案内はしない）", async () => {
    await open("/onboarding/restaurant/1");
    expect(el.textContent).toContain("今は入力しなくても登録できます");
    expect(el.textContent).not.toContain("マイページ");
  });

  it("まだ済んでいない STEP より先の URL を開くと、最初の未入力の STEP へ", async () => {
    await open("/onboarding/restaurant/4");
    expect(path).toBe("/onboarding/restaurant/1");
  });

  it("再読み込みしても、このタブで入力した内容は残る（パスワード等は保存しない）", async () => {
    sessionStorage.setItem("ai-chiiki:onboarding:v1:u-r:restaurant", JSON.stringify({ name: "保存した店", businessType: "cafe", prefecture: "京都府", city: "京都市" }));
    await open("/onboarding/restaurant/2");
    expect(path).toBe("/onboarding/restaurant/2");
    await back();
    expect(($<HTMLInputElement>('input[name="name"]'))!.value).toBe("保存した店");
    expect(checked("businessType")).toEqual(["カフェ"]);
  });

  it("サーバーが入力の誤りを返したら、その STEP に戻って項目の近くに出す", async () => {
    sessionStorage.setItem("ai-chiiki:onboarding:v1:u-r:restaurant", JSON.stringify({
      name: "店", businessType: "cafe", prefecture: "京都府", city: "京都市", purchaseFrequency: "weekly", purchaseVolume: "small",
      irregularPolicy: "avoid", firstTimePolicy: "include", pickupTimes: ["any"], priorities: ["price"],
    }));
    postResponse = () => ({ status: 400, body: { error: "入力内容を確認してください", errors: { city: "市区町村を確認してください" } } });
    await open("/onboarding/restaurant/4");
    await next();
    await flush(3);
    expect(path).toBe("/onboarding/restaurant/1");
    expect(errorsShown()).toContain("市区町村を確認してください");
  });

  it("通信できなかったときは、確認画面にとどまって知らせる", async () => {
    sessionStorage.setItem("ai-chiiki:onboarding:v1:u-r:restaurant", JSON.stringify({
      name: "店", businessType: "cafe", prefecture: "京都府", city: "京都市", purchaseFrequency: "weekly", purchaseVolume: "small",
      irregularPolicy: "avoid", firstTimePolicy: "include", pickupTimes: ["any"], priorities: ["price"],
    }));
    postResponse = () => ({ status: 500, body: { error: "サーバーで問題が発生しました。時間をおいてもう一度お試しください" } });
    await open("/onboarding/restaurant/4");
    await next();
    await flush(3);
    expect(path).toBe("/onboarding/restaurant/4");
    expect($(".alert.bad")?.textContent).toContain("サーバーで問題が発生しました");
  });

  it("ログアウトすると入力途中の内容を消す", async () => {
    await open("/onboarding/restaurant/1");
    await type("name", "途中の店");
    expect(sessionStorage.getItem("ai-chiiki:onboarding:v1:u-r:restaurant")).toContain("途中の店");
    await act(async () => { [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("ログアウト"))!.click(); });
    await flush(3);
    expect(sessionStorage.getItem("ai-chiiki:onboarding:v1:u-r:restaurant")).toBeNull();
  });
});

describe("生産者の初回登録（4 STEP）", () => {
  beforeEach(() => { me = { id: "u-p", role: "producer", displayName: "（未設定）", producer: null, onboarded: false }; });

  it("入力 → 受渡枠を選ぶ → 連絡先 → 完了 → ホーム", async () => {
    await open("/onboarding/producer");
    expect(path).toBe("/onboarding/producer/1");
    expect($(".bottom-nav")).toBeNull();
    await type("farmName", "みどり農園");
    await type("producerName", "山田 花子");
    await choose("prefecture", "大阪府");
    await type("city", "堺市南区");
    await next();
    expect(path).toBe("/onboarding/producer/2");

    // 品目マスタから選ぶ。その他の作物はプロフィール情報（出品はできない）と分かる
    expect(el.textContent).toContain("出品できるのは、この一覧にある品目です");
    expect(el.textContent).toContain("その他の作物はプロフィール情報として登録されます");
    await next();
    expect(errorsShown()).toEqual(expect.arrayContaining(["主な作物を1つ以上選んでください", "生産のスタイルを選んでください"]));
    await pick("itemIds", "トマト");
    await pick("itemIds", "なす");
    await pick("productionStyle", "少量多品目");
    await pick("salesChannels", "直売所");
    await pick("directTradeExperience", "経験あり");
    await next();
    expect(path).toBe("/onboarding/producer/3");

    // 受渡枠は人が読める形で表示し、内部の ID は出さない
    expect(el.textContent).toContain("梅田エリア受渡所（仮）");
    expect(el.textContent).toContain("毎週火曜日 10:00〜11:00・受渡料金 800円");
    expect(el.textContent).not.toContain("s-umeda");
    await next();
    expect(errorsShown()).toContain("参加する受渡枠を1つ以上選んでください");
    await pick("capabilities", "少量対応");
    await pick("capabilities", "規格外品");
    await pick("capabilities", "飲食店との直接相談");
    await pick("seriesIds", "梅田エリア受渡所（仮）");
    await next();
    expect(path).toBe("/onboarding/producer/4");

    expect(el.textContent).toContain("この連絡先は、あなたが「対応できます」と返事をした飲食店だけに表示されます");
    expect($<HTMLInputElement>('input[name="contactEmail"]')!.value).toBe(""); // ログイン用のメールは自動で入れない
    expect($(".style-text")?.textContent).toBe("少量対応 × 規格外OK × 直接取引OK");
    await next();
    expect(errorsShown()).toContain("電話番号かメールアドレスのどちらかを入力してください");
    expect(posted).toHaveLength(0);
    await type("contactEmail", "farm@");
    await next();
    expect(errorsShown()).toContain("メールアドレスを確認してください（例：farm@example.com）");
    await type("contactEmail", "midori@example.com");
    await next();
    await flush(4);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("/api/onboarding/producer");
    expect(posted[0].body).toMatchObject({ farmName: "みどり農園", itemIds: ["i-tomato", "i-eggplant"], seriesIds: ["s-umeda"], contactEmail: "midori@example.com", contactPhone: "" });
    expect(path).toBe("/producer/home");
    expect($(".bottom-nav")).not.toBeNull();
    expect($("[role=status]")?.textContent).toContain("登録が完了しました");
  });

  it("販売先・対応できることは選ばなくても登録できる。作物・受渡枠・連絡先は必須のまま", async () => {
    sessionStorage.setItem("ai-chiiki:onboarding:v1:u-p:producer", JSON.stringify({ farmName: "農園", producerName: "名", prefecture: "奈良県", city: "奈良市" }));
    await open("/onboarding/producer/2");
    await pick("productionStyle", "特定品目中心");
    await pick("directTradeExperience", "経験あり");
    await next();
    expect(path).toBe("/onboarding/producer/2");
    expect(errorsShown()).toEqual(["主な作物を1つ以上選んでください"]); // 販売先は誤りにならない
    await pick("itemIds", "トマト");
    await next();
    expect(path).toBe("/onboarding/producer/3");
    await next();
    expect(errorsShown()).toEqual(["参加する受渡枠を1つ以上選んでください"]); // 対応できることは誤りにならない
    await pick("seriesIds", "天王寺エリア受渡所（仮）");
    await next();
    await type("contactPhone", "090-0000-0000");
    expect($(".style-text")?.textContent).toBe("直接取引の経験あり × 特定品目中心");
    await next();
    await flush(4);
    expect(posted[0].body).toMatchObject({ salesChannels: [], capabilities: [], itemIds: ["i-tomato"], seriesIds: ["s-tennoji"] });
    expect(path).toBe("/producer/home");
  });

  it("戻っても選んだ作物・受渡枠は残る", async () => {
    sessionStorage.setItem("ai-chiiki:onboarding:v1:u-p:producer", JSON.stringify({
      farmName: "農園", producerName: "名", prefecture: "奈良県", city: "奈良市", itemIds: ["i-onion"], productionStyle: "seasonal",
      salesChannels: ["ja"], directTradeExperience: "never", seriesIds: ["s-tennoji"],
    }));
    await open("/onboarding/producer/4");
    expect(path).toBe("/onboarding/producer/4");
    await back();
    expect(checked("seriesIds")).toEqual(["天王寺エリア受渡所（仮）"]);
    await back();
    expect(checked("itemIds")).toEqual(["玉ねぎ"]);
  });

  it("今は選べない受渡枠（保存していた古い選択）は外す", async () => {
    sessionStorage.setItem("ai-chiiki:onboarding:v1:u-p:producer", JSON.stringify({
      farmName: "農園", producerName: "名", prefecture: "奈良県", city: "奈良市", itemIds: ["i-onion", "i-gone"], productionStyle: "seasonal",
      salesChannels: ["ja"], directTradeExperience: "never", seriesIds: ["s-stopped"],
    }));
    await open("/onboarding/producer/3");
    expect(checked("seriesIds")).toEqual([]);
    const saved = JSON.parse(sessionStorage.getItem("ai-chiiki:onboarding:v1:u-p:producer")!);
    expect(saved.seriesIds).toEqual([]);
    expect(saved.itemIds).toEqual(["i-onion"]);
  });
});
