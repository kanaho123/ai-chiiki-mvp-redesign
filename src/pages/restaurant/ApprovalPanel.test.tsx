// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_AN_ORDER, STALE_RECHECK, type Confirmation, type ConfirmationStatus, type Contact } from "../../lib/approvals";
import { SessionProvider } from "../../routes/session";
import { ApprovalPanel } from "./ApprovalPanel";
import type { Freshness, Shown } from "./types";

// 仕入れ案の画面の「生産者に仕入れ相談する」：依頼の送信・農家ごとの状態・マッチ成立・取引相談へ進む。
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
async function open(freshness: Freshness = "fresh") {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => { root!.render(<SessionProvider><ApprovalPanel shown={shown} freshness={freshness} /></SessionProvider>); });
  await flush();
}
const $ = (sel: string) => el.querySelector<HTMLElement>(sel);
const text = () => el.textContent ?? "";
const button = (label: string) => [...el.querySelectorAll("button, a")].find((b) => b.textContent?.trim().includes(label)) as HTMLElement | undefined;
const click = async (node: HTMLElement | undefined) => { expect(node).toBeTruthy(); await act(async () => { node!.click(); }); await flush(); };
const statuses = () => [...el.querySelectorAll(".confirmation-list li")].map((li) => `${li.querySelector("strong")?.textContent}：${li.querySelector(".confirmation-status")?.textContent}`);

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

  it("一部の農家だけ「対応できます」：農家ごとの状態と回答済みの数だけ。マッチ成立・「一部成立」は出さない", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "pending")];
    await open();
    expect(statuses()).toEqual(["A農園 5kg：対応できます", "B農園 5kg：返事待ち"]);
    expect($(".confirmation-overall")?.textContent).toBe("返事待ち（1/2農家が回答済み）");
    expect($(".match-banner")).toBeNull();
    expect(text()).not.toMatch(/マッチ成立|一部成立/);
    expect(button("連絡先を見る")).toBeTruthy(); // 農家ごとの連絡先はこれまでどおり
    contacts = { a: { contactPhone: "000-0000-0001", contactEmail: null } };
    await click(button("連絡先を見る"));
    expect($(".contact-details .hint")?.textContent).toBe("受け渡しの詳細や最終確認は、農家と直接相談して決めてください。example.invalid はデモ用の架空の宛先です。");
    expect(text()).not.toMatch(/数量・受け?取/);
  });

  it("全農家が「対応できます」：🎉 マッチ成立・そろった条件・注文確定ではない旨・取引相談へ進む", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    await open();
    const banner = $(".match-banner")!;
    expect(banner.querySelector(".match-title")?.textContent).toBe("🎉 マッチ成立");
    expect(banner.querySelector(".match-text")?.textContent).toBe("A農園・B農園と、数量・価格・受け渡し条件がそろいました");
    expect(banner.querySelector(".match-note")?.textContent).toBe(NOT_AN_ORDER);
    expect(NOT_AN_ORDER).toBe("これは注文確定ではありません。在庫の確保も行われません。");
    expect($(".confirmation-overall")).toBeNull();
    expect(statuses()).toEqual(["A農園 5kg：対応できます", "B農園 5kg：対応できます"]);
    expect(calls.some((c) => /^\/api\/approvals\/./.test(c.url))).toBe(false); // 押すまでは連絡先を取りに行かない
  });

  it("取引相談へ進む：登録されている連絡手段だけ（電話だけ・メールだけの農家でも崩れない）", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    contacts = { a: { contactPhone: "000-0000-0001", contactEmail: null }, b: { contactPhone: null, contactEmail: "b-farm@example.invalid" } };
    await open();
    await click(button("取引相談へ進む"));
    expect(calls.filter((c) => /^\/api\/approvals\/./.test(c.url)).map((c) => c.url).sort()).toEqual(["/api/approvals/a", "/api/approvals/b"]);
    const [a, b] = [...el.querySelectorAll(".deal-farm")];
    expect(a.querySelector(".deal-farm-name")?.textContent).toBe("A農園");
    expect(a.querySelector(".deal-mail")).toBeNull();
    expect(a.querySelector(".deal-tel")?.getAttribute("href")).toBe("tel:00000000001");
    expect(a.querySelector(".deal-tel")?.textContent).toBe("電話で相談する（000-0000-0001）");
    expect(b.querySelector(".deal-tel")).toBeNull();
    expect(b.querySelector(".deal-mail")?.textContent).toBe("B農園にメールで相談する");
    expect(b.querySelector(".deal-address")?.textContent).toBe("メール：b-farm@example.invalid");
    expect(text()).toContain("example.invalid はデモ用の架空の宛先です。");
  });

  it("取引相談のメール：件名と本文にそろった条件。本文は受け渡しの詳細と最終確認の相談（数量の相談にしない）", async () => {
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    contacts = { a: { contactPhone: "000-0000-0001", contactEmail: "a-farm@example.invalid" }, b: { contactPhone: null, contactEmail: "b-farm@example.invalid" } };
    await open();
    await click(button("取引相談へ進む"));
    const href = el.querySelector(".deal-farm .deal-mail")!.getAttribute("href")!;
    const [to, query] = href.replace(/^mailto:/, "").split("?");
    expect(decodeURIComponent(to)).toBe("a-farm@example.invalid");
    const q = new URLSearchParams(query);
    const subject = q.get("subject")!;
    expect(subject.startsWith("【仕入れ相談】トマト 5kg（10月23日")).toBe(true);
    expect(subject.endsWith("10:00〜11:00・受渡拠点P）")).toBe(true);
    const body = q.get("body")!;
    expect(body).toContain("A農園 御中");
    expect(body).toContain("AI地域商社で仕入れ相談をお送りしたまちの食堂です。");
    expect(body).toContain("品目：トマト 5kg（¥600/kg・商品代 ¥3,000）");
    expect(body).toContain("受渡拠点P");
    expect(body).toContain("受け渡しの詳細や最終確認について、ご相談させてください。");
    expect(body).not.toContain("数量・受け取り方法");
    expect(el.querySelectorAll(".deal-farm")[0].querySelector(".deal-tel")).not.toBeNull();
  });

  it("一般向けの環境では、デモ用の架空の宛先の注意を出さない", async () => {
    mode = "general";
    rows = [row("a", "A農園", "approved"), row("b", "B農園", "approved")];
    contacts = { a: { contactPhone: "090-1234-5678", contactEmail: null }, b: { contactPhone: "090-1234-0000", contactEmail: null } };
    await open();
    await click(button("取引相談へ進む"));
    expect(el.querySelectorAll(".deal-tel")).toHaveLength(2);
    expect(text()).not.toContain("example.invalid");
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
