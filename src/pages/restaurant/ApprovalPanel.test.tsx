// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { STALE_RECHECK, type Confirmation, type ConfirmationStatus, type Contact } from "../../lib/approvals";
import { SessionProvider } from "../../routes/session";
import { ApprovalPanel } from "./ApprovalPanel";
import type { Freshness, Shown } from "./types";

// 仕入れ案の画面の「生産者に仕入れ相談する」：依頼の送信・農家ごとの状態・マッチ成立（短い表示と相談の詳細への導線だけ）。
// サーバー側の権限・連絡先の開示の制御は server/approvals.test.ts で本物の処理を使って確かめている。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FP = "f".repeat(64);
const shown = {
  plan: { status: "MATCHED", allocations: [{ supplyId: "sa", producerName: "A農園" }, { supplyId: "sb", producerName: "B農園" }] },
  request: { itemId: "tomato", slotId: "slot" }, version: "v1", fingerprint: FP, suggestions: [], demoClock: false,
} as unknown as Shown;
const row = (id: string, producerName: string, status: ConfirmationStatus): Confirmation => ({
  id, supplyId: `s-${id}`, producerName, restaurantName: "まちの食堂", planFingerprint: FP, itemName: "トマト", quantityKg: 5,
  priceYenPerKg: 600, subtotalYen: 3000, pickupStartAt: "2026-10-23T01:00:00.000Z", pickupEndAt: "2026-10-23T02:00:00.000Z",
  pickupPlace: "受渡拠点P", status, createdAt: "2026-10-20T00:00:00.000Z",
});

let rows: Confirmation[] = [];
let contacts: Record<string, Contact> = {};
let calls: { url: string; method: string }[] = [];
let mode: "general" | "demo" = "demo";
beforeEach(() => {
  rows = []; contacts = {}; calls = []; mode = "demo";
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ user: { id: "u-r", role: "restaurant", displayName: "まちの食堂", producer: null, onboarded: true }, demoNow: null, appMode: mode });
    if (url === "/api/approvals" && method === "POST") { rows = [row("a", "A農園", "pending"), row("b", "B農園", "pending")]; return json({ requests: rows }); }
    if (url.startsWith("/api/approvals?fingerprint=")) return json({ requests: rows });
    const one = /^\/api\/approvals\/(.+)$/.exec(url);
    if (one) {
      const r = rows.find((x) => x.id === decodeURIComponent(one[1]));
      return r?.status === "approved" ? json({ contact: contacts[r.id] }) : json({ error: "まだ連絡先は見られません" }, 403);
    }
    return json({ error: "not found" }, 404);
  }));
});

let root: Root | null = null;
let el: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); el?.remove(); root = null; vi.unstubAllGlobals(); });
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
let matchedCalls: boolean[] = [];
const onMatchedChange = (m: boolean) => { matchedCalls.push(m); };
async function open(freshness: Freshness = "fresh") {
  matchedCalls = [];
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => { root!.render(<SessionProvider><MemoryRouter><ApprovalPanel shown={shown} freshness={freshness} onMatchedChange={onMatchedChange} /></MemoryRouter></SessionProvider>); });
  await flush();
}
const $ = (sel: string) => el.querySelector<HTMLElement>(sel);
const text = () => el.textContent ?? "";
const button = (label: string) => [...el.querySelectorAll("button, a")].find((b) => b.textContent?.trim().includes(label)) as HTMLElement | undefined;
const click = async (node: HTMLElement | undefined) => { expect(node).toBeTruthy(); await act(async () => { node!.click(); }); await flush(); };
const statuses = () => [...el.querySelectorAll(".confirmation-list li")].map((li) => `${li.querySelector("strong")?.textContent}：${li.querySelector(".confirmation-status")?.textContent}`);

describe("仕入れ案の上部へのマッチ成立の知らせ（onMatchedChange）", () => {
  it("1/2 の回答では知らせない", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "pending")];
    await open();
    expect(matchedCalls.at(-1)).toBe(false);
    expect(matchedCalls).not.toContain(true);
  });
  it("2/2 で「対応できます」になったときだけ知らせる", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    await open();
    expect(matchedCalls.at(-1)).toBe(true);
  });
  it("案が古い（在庫が変わった）・農家の相談が stale なら知らせない", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    await open("stale");
    expect(matchedCalls).not.toContain(true);
    act(() => root?.unmount()); root = null; el.remove();
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "stale")];
    await open();
    expect(matchedCalls).not.toContain(true);
  });
});

describe("生産者に仕入れ相談する", () => {
  it("送る前：見出し・送り先の農家・「A農園・B農園に仕入れ相談する（2件）」で、まとめて1回送る", async () => {
    await open();
    expect($("#confirm-producers-title")?.textContent).toBe("生産者に仕入れ相談する");
    expect(text()).toContain("この仕入れ案の農家（A農園・B農園）に、この条件で相談できるか確認します。");
    await click(button("A農園・B農園に仕入れ相談する（2件）"));
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["/api/approvals"]);
    expect(statuses()).toEqual(["A農園 5kg：返事待ち", "B農園 5kg：返事待ち"]);
    expect($(".confirmation-overall")?.textContent).toBe("返事待ち");
    expect($(".match-banner")).toBeNull();
  });

  it("一部の農家だけ「対応できます」：農家ごとの状態と回答済みの数だけ。マッチ成立・「一部成立」・連絡先は出さない", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "pending")];
    await open();
    expect(statuses()).toEqual(["A農園 5kg：対応できます", "B農園 5kg：返事待ち"]);
    expect($(".confirmation-overall")?.textContent).toBe("返事待ち（1/2農家が回答済み）");
    expect($(".match-banner")).toBeNull();
    // 進み具合では「マッチ成立」はまだ先の段階（todo）。成立した・一部成立したとは表示しない
    expect([...el.querySelectorAll(".progress-step")].map((s) => s.className.replace("progress-step ", ""))).toEqual(["done", "current"]); // まだ先の段階（マッチ成立・受け渡し待ち）は出さない
    expect($(".progress-current")?.textContent).toBe("いま：生産者回答待ち（1/2農家が回答済み）");
    expect(text()).not.toMatch(/マッチ成立|一部成立|🎉/);
    expect(button("連絡先を見る")).toBeUndefined(); // 連絡先・トークは相談の詳細で扱う
    expect(text()).not.toMatch(/数量・受け?取/);
  });

  it("全農家が「対応できます」：短く「マッチ成立」「生産者とのやり取りができます」と、相談の詳細への「相談状況・やり取りを見る」だけ", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    await open();
    const banner = $(".match-banner")!;
    expect(banner.querySelector(".match-title")?.textContent).toBe("マッチ成立");
    expect(banner.querySelector(".match-text")?.textContent).toBe("生産者とのやり取りができます");
    const go = banner.querySelector<HTMLAnchorElement>("a.match-go")!;
    expect(go.textContent).toBe("相談状況・やり取りを見る");
    expect(go.getAttribute("href")).toBe(`/restaurant/consultations/${FP}`);
    // 重複していた表示・取引の機能は出さない（農家一覧・希望日や受け渡し・長い説明・取引相談へ進む・電話やメール・連絡先）
    expect($(".confirmation-overall")).toBeNull();
    expect($(".confirmation-list")).toBeNull();
    expect(text()).not.toMatch(/取引相談へ進む|注文確定|在庫の確保|電話|メール|連絡先|そろいました|確認状態を更新する/);
    expect(el.querySelectorAll("a, button")).toHaveLength(1);
    expect(calls.some((c) => /^\/api\/approvals\/./.test(c.url))).toBe(false);
  });

  it("3農家で成立しても同じ短い表示（農家の数だけボタンを並べない）", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved"), row("c", "C農園", "approved")];
    await open();
    expect($(".match-banner .match-title")?.textContent).toBe("マッチ成立");
    expect(el.querySelectorAll(".match-banner a")).toHaveLength(1);
    expect($(".confirmation-list")).toBeNull();
    expect(text()).not.toMatch(/電話|メール|連絡先/);
  });

  it("在庫が変わった（stale）：マッチ成立は出さず、もう一度の確認を案内する", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    await open("stale");
    expect($(".match-banner")).toBeNull();
    expect(text()).toContain(STALE_RECHECK);
    expect(STALE_RECHECK).toBe("在庫や条件が変わったため、現在の条件でもう一度確認が必要です。仕入れ案を計算し直して、改めて相談してください。");
  });

  it("サーバーが条件の変化（stale）を返した農家があれば、全員が対応できてもマッチ成立にしない", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "stale")];
    await open();
    expect($(".match-banner")).toBeNull();
    expect($(".confirmation-overall")?.textContent).toBe("条件が変わりました");
  });
});
