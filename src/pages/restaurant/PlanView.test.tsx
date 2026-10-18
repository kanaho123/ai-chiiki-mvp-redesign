// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allocatePlan, type PlanRequest, type PlanSlot, type PlanSupply } from "../../lib/allocate";
import { SessionProvider } from "../../routes/session";
import { PlanView } from "./PlanView";
import type { PlanOption, Shown } from "./types";

// 仕入れ案の画面の「受け取りの見通し」（受け取り1か所・理由）と「ほかの受け取り方」。案そのものは既存の allocatePlan で作る。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!("ResizeObserver" in globalThis)) (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const NOW = new Date("2026-10-22T03:00:00Z");
const slot: PlanSlot = { id: "slot-x", label: "直売所X・金16:00", placeName: "直売所X", startAt: "2026-10-23T07:00:00.000Z", endAt: "2026-10-23T09:00:00.000Z", confirmDeadlineAt: "2026-10-22T14:00:00.000Z", feeYen: 0, feeConfirmed: true, maxKg: 100, conditionsConfirmed: true };
const supply = (key: string, kg: number): PlanSupply => ({ id: `s-${key}`, producerId: `p-${key}`, producerName: `${key}農園`, itemId: "tomato", varietyId: "v", varietyName: "指定なし", grade: "regular", irregularReason: null, originPrefecture: "大阪府", availableKg: kg, priceYenPerKg: 600, minKg: 1, slotId: "slot-x", published: true, version: 1, updatedAt: "2026-10-21T00:00:00.000Z" });
const request: PlanRequest = { itemId: "tomato", varietyId: null, quantityKg: 10, desiredDate: "2026-10-23", budgetYen: null, originPrefectures: ["大阪府"], slotId: "slot-x", allowIrregular: false, allowMixedVarieties: false, allowMixedGrades: false, allowFirstTime: true, preferredProducerId: null };
function shownFor(supplies: PlanSupply[]): Shown {
  const plan = allocatePlan({ request, supplies, slot, participants: supplies.map((s) => ({ slotId: "slot-x", producerId: s.producerId, confirmed: true })), relationships: [], now: NOW });
  return { plan, request, version: "v1", fingerprint: "f".repeat(64), suggestions: [], demoClock: false };
}
const option = (slotId: string, o: Partial<PlanOption>): PlanOption => ({ slotId, label: slotId, placeName: slotId, placeAddress: "", placeKind: null, startAt: "2026-10-23T07:00:00.000Z", endAt: "2026-10-23T09:00:00.000Z", status: "MATCHED", requestedKg: 10, fulfilledKg: 10, shortageKg: 0, producerCount: 1, totalYen: 6000, farms: [], ...o });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/api/me")) return json({ user: { id: "u-r", role: "restaurant", displayName: "まちの食堂", producer: null, onboarded: true }, demoNow: null, appMode: "general" });
    if (url.startsWith("/api/approvals")) return json({ requests: [] });
    return json({});
  }));
});
let root: Root | null = null;
let el: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); el?.remove(); root = null; vi.unstubAllGlobals(); });
async function open(shown: Shown, options: PlanOption[] | null, onPickOption = vi.fn()) {
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
  await act(async () => {
    root!.render(<SessionProvider><PlanView shown={shown} freshness="fresh" busy={false} busyLabel="計算中…" error={null} onRecalc={() => {}} onEdit={() => {}} onSuggestion={() => {}} options={options} onPickOption={onPickOption} /></SessionProvider>);
  });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return onPickOption;
}
const text = () => el.textContent ?? "";

describe("受け取りの見通し", () => {
  it("2農家・1か所：「受け取りは1か所です」「2農家から仕入れますが、同じ場所でまとめて受け取れます」と、地点の種類", async () => {
    await open(shownFor([supply("A", 5), supply("B", 5)]), [option("slot-x", { placeKind: "direct_store", producerCount: 2 })]);
    expect(el.querySelector(".answer-head")?.textContent).toContain("10kg 揃いました");
    expect(el.querySelector(".pickup-summary b")?.textContent).toBe("受け取りは1か所です");
    expect(el.querySelector(".pickup-reason")?.textContent).toBe("2農家から仕入れますが、同じ場所でまとめて受け取れます");
    expect(el.querySelector(".answer-meta .place-kind")?.textContent).toBe("直売所");
  });
  it("1農家で満たせる案：「1農家で必要な量を確保できます」", async () => {
    await open(shownFor([supply("C", 10)]), null);
    expect(el.querySelector(".pickup-reason")?.textContent).toBe("1農家で必要な量を確保できます");
    expect(el.querySelector(".alt-options")).toBeNull(); // おまかせでなければ、ほかの案は出さない
  });
  it("足りない案には「まとめて受け取れます」の理由を出さない", async () => {
    await open(shownFor([supply("A", 5)]), null);
    expect(el.querySelector(".answer-head")?.textContent).toContain("足りません");
    expect(el.querySelector(".pickup-reason")).toBeNull();
  });
});

describe("ほかの受け取り方（おまかせのときだけ）", () => {
  it("表示中の場所以外の案を、確保量・農家数・受け取り1か所・合計で並べ、「この案を見る」で選べる", async () => {
    const options = [
      option("slot-x", { placeName: "直売所X", placeKind: "direct_store", producerCount: 2 }),
      option("slot-y", { placeName: "集荷場Y", placeKind: "collection_point", producerCount: 1, totalYen: 6200, farms: [{ producerName: "C農園", kg: 10 }] }),
      option("slot-z", { placeName: "農園Z", placeKind: "farm", status: "NOT_MATCHED", fulfilledKg: 8, shortageKg: 2, producerCount: 1, totalYen: 4800, farms: [{ producerName: "D農園", kg: 8 }] }),
      option("slot-empty", { fulfilledKg: 0, status: "NOT_MATCHED", shortageKg: 10 }),
    ];
    const pick = await open(shownFor([supply("A", 5), supply("B", 5)]), options);
    expect(text()).toContain("受け取れる場所 4か所の中から、おすすめの案を選びました");
    const rows = [...el.querySelectorAll(".alt-option")];
    expect(rows.map((r) => r.querySelector(".alt-place")?.textContent)).toEqual(["集荷場Y集荷場", "農園Z農園"]); // 0kg の場所は出さない
    expect(rows[0].querySelector(".alt-farms")?.textContent).toBe("C農園 10kg");
    expect(rows[0].querySelector(".alt-sum")?.textContent).toBe("10kg確保・1農家・受け取り1か所・¥6,200");
    expect(rows[1].querySelector(".alt-sum")?.textContent).toBe("8kgまで（2kg不足）・1農家・受け取り1か所・¥4,800");
    await act(async () => { (rows[0].querySelector("button") as HTMLButtonElement).click(); });
    expect(pick).toHaveBeenCalledWith("slot-y");
  });
});
