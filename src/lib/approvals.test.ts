import { describe, expect, it } from "vitest";
import {
  classifyRequests, confirmationLabel, consultationLabel, consultationStatus, farmNames, groupConsultations, isMatched, isOngoing, matchMessage,
  overallConfirmation, pendingCount, restaurantTodo,
  type Confirmation, type ConfirmationStatus,
} from "./approvals";

const row = (over: Partial<Confirmation> & { id: string; status: ConfirmationStatus }): Confirmation => ({
  supplyId: `s-${over.id}`, producerName: "A農園", restaurantName: "テスト食堂", planFingerprint: "fp-1", itemName: "トマト",
  quantityKg: 5, priceYenPerKg: 600, subtotalYen: 3000, pickupStartAt: "2026-10-23T01:00:00.000Z", pickupEndAt: "2026-10-23T02:00:00.000Z",
  pickupPlace: "受渡拠点P", createdAt: "2026-10-20T00:00:00.000Z", ...over,
});

describe("ふつうの言葉の状態", () => {
  it("システム用語（承認・NG・Reject）を使わない", () => {
    const all = [...Object.values(confirmationLabel), ...Object.values(consultationLabel)].join();
    expect(all).not.toMatch(/承認|NG|Reject|reject|pending/);
    expect(confirmationLabel).toEqual({ pending: "返事待ち", approved: "対応できます", rejected: "今回は対応できません", stale: "条件が変わりました" });
  });
  it.each([
    [["pending", "pending"], "waiting"], [["approved", "pending"], "waiting"], [["approved", "approved"], "accepted"],
    [["approved", "rejected"], "partial"], [["pending", "rejected"], "partial"], [["rejected", "rejected"], "declined"],
    [["approved", "stale"], "stale"], [["rejected", "stale"], "stale"],
  ] as const)("%j → %s", (statuses, want) => {
    expect(consultationStatus(statuses.map((status) => ({ status })))).toBe(want);
  });
});

describe("飲食店の相談（仕入れ案ごとにまとめる）", () => {
  const rows = [
    row({ id: "1", status: "approved", producerName: "B農園", quantityKg: 5, subtotalYen: 2750, planFingerprint: "fp-new", createdAt: "2026-10-21T00:00:00.000Z" }),
    row({ id: "2", status: "pending", producerName: "A農園", quantityKg: 5, subtotalYen: 3000, planFingerprint: "fp-new", createdAt: "2026-10-21T00:00:00.000Z" }),
    row({ id: "3", status: "rejected", planFingerprint: "fp-old", itemName: "なす", quantityKg: 8 }),
  ];
  it("同じ仕入れ案の依頼を1つの相談にし、合計の量・金額と農家ごとの状態を持つ（新しい相談が先）", () => {
    const cs = groupConsultations(rows);
    expect(cs.map((c) => c.id)).toEqual(["fp-new", "fp-old"]);
    expect(cs[0]).toMatchObject({ itemName: "トマト", totalKg: 10, subtotalYen: 5750, status: "waiting" });
    expect(cs[0].farms.map((f) => `${f.producerName}:${confirmationLabel[f.status]}`)).toEqual(["A農園:返事待ち", "B農園:対応できます"]);
    expect(cs[1]).toMatchObject({ itemName: "なす", totalKg: 8, status: "declined" });
    expect(cs.filter(isOngoing).map((c) => c.id)).toEqual(["fp-new"]);
  });
  it("今やること：対応できる農家がいれば連絡先の確認、返事待ちなら待つ、なければ仕入れ案をつくる", () => {
    expect(restaurantTodo(groupConsultations(rows))).toMatchObject({ to: "consultations", text: expect.stringContaining("B農園が「対応できます」") });
    expect(restaurantTodo(groupConsultations([row({ id: "x", status: "pending" })]))).toMatchObject({ to: "consultations", text: expect.stringContaining("返事を待っています") });
    expect(restaurantTodo([])).toMatchObject({ to: "buy" });
    expect(restaurantTodo(groupConsultations([row({ id: "y", status: "rejected" }), row({ id: "z", status: "stale", planFingerprint: "fp-2" })]))).toMatchObject({ to: "buy" });
  });
});

describe("生産者の依頼（分類と未対応の数）", () => {
  const rows = [
    row({ id: "p-late", status: "pending", pickupStartAt: "2026-10-30T01:00:00.000Z" }),
    row({ id: "p-soon", status: "pending", pickupStartAt: "2026-10-23T01:00:00.000Z" }),
    row({ id: "ok", status: "approved" }), row({ id: "ng", status: "rejected" }), row({ id: "old", status: "stale" }),
  ];
  it("未対応（受け渡しが近い順）・対応済・今回は難しい・条件が変わったものに分ける", () => {
    const g = classifyRequests(rows);
    expect(g.pending.map((r) => r.id)).toEqual(["p-soon", "p-late"]);
    expect(g.accepted.map((r) => r.id)).toEqual(["ok"]);
    expect(g.declined.map((r) => r.id)).toEqual(["ng"]);
    expect(g.closed.map((r) => r.id)).toEqual(["old"]);
  });
  it("未対応の数は返事が必要なものだけ（条件が変わったものは数えない）", () => {
    expect(pendingCount([])).toBe(0);
    expect(pendingCount([row({ id: "a", status: "pending" })])).toBe(1);
    expect(pendingCount(rows)).toBe(2);
  });
});

describe("マッチ成立（全農家が「対応できます」で、条件が変わっていないときだけ）", () => {
  const two = (a: ConfirmationStatus, b: ConfirmationStatus) => [row({ id: "a", status: a }), row({ id: "b", status: b, producerName: "B農園" })];
  it("全農家が approved のときだけ成立。一部・stale・空は成立にしない", () => {
    expect(isMatched(two("approved", "approved"))).toBe(true);
    expect(isMatched(two("approved", "pending"))).toBe(false);
    expect(isMatched(two("approved", "rejected"))).toBe(false);
    expect(isMatched(two("approved", "stale"))).toBe(false);
    expect(isMatched([])).toBe(false);
    expect(consultationLabel.accepted).toBe("マッチ成立");
    expect(Object.values(consultationLabel).join()).not.toContain("一部成立");
  });
  it("全体の状態：返事待ちには回答済みの数だけを添え、成立は全員のときだけ", () => {
    expect(overallConfirmation([])).toBe("まだ依頼していません");
    expect(overallConfirmation(two("pending", "pending"))).toBe("返事待ち");
    expect(overallConfirmation(two("approved", "pending"))).toBe("返事待ち（1/2農家が回答済み）");
    expect(overallConfirmation(two("approved", "approved"))).toBe("マッチ成立");
    expect(overallConfirmation(two("approved", "rejected"))).toBe("一部対応できません");
    expect(overallConfirmation(two("approved", "stale"))).toBe("条件が変わりました");
  });
  it("農家名と成立の説明（同じ農家は1回だけ）", () => {
    expect(farmNames([...two("approved", "approved"), row({ id: "c", status: "approved" })])).toBe("A農園・B農園");
    expect(matchMessage(two("approved", "approved"))).toBe("A農園・B農園と、数量・価格・受け渡し条件がそろいました");
  });
  it("今やること：成立 → 取引相談へ、一部だけ → ほかの農家を待つ、一部対応できない → 従来どおり", () => {
    expect(restaurantTodo(groupConsultations(two("approved", "approved"))).text).toBe("🎉 マッチ成立：A農園・B農園と条件がそろいました。取引相談へ進みましょう（注文確定ではありません）");
    expect(restaurantTodo(groupConsultations(two("approved", "pending"))).text).toBe("A農園が「対応できます」と返事をしました。ほかの農家の返事を待っています");
    expect(restaurantTodo(groupConsultations(two("approved", "rejected"))).text).toContain("A農園が「対応できます」と返事をしました。連絡先を確認して");
    expect(restaurantTodo(groupConsultations(two("approved", "stale"))).to).toBe("buy");
  });
});
