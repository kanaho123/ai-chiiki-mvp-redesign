import { describe, expect, it } from "vitest";
import { PREFECTURES } from "./constants.js";
import { formFromDraft, missingFields, toPlanBody } from "./request-form.js";
import { dateCandidates, resolveExtraction, type Catalog } from "./resolve.js";
import { parseExtraction, parsePlanRequest, parseRequestText, type ExtractedRequest } from "./validate.js";

const NOW = new Date("2026-10-22T12:00:00+09:00"); // DEMO_NOW（木曜）

const catalog: Catalog = {
  items: [{ id: "demo-item-tomato", name: "トマト", varieties: [{ id: "demo-variety-t", name: "デモ品種T" }] }],
  slots: [
    { id: "demo-slot-gp", label: "G-P", placeName: "受渡拠点P（架空）", placeAddress: "大阪府内（デモ用の架空拠点）", startAt: "2026-10-23T01:00:00.000Z", endAt: "2026-10-23T02:00:00.000Z" },
    { id: "demo-slot-gq", label: "G-Q", placeName: "受渡拠点Q（架空）", placeAddress: "大阪府内（デモ用の架空拠点・Pとは別）", startAt: "2026-10-23T01:00:00.000Z", endAt: "2026-10-23T02:00:00.000Z" },
  ],
  prefectures: PREFECTURES,
  priorTradeProducers: [{ id: "demo-producer-a", name: "A農園" }],
  producers: ["a", "b", "c", "d"].map((k) => ({ id: `demo-producer-${k}`, name: `${k.toUpperCase()}農園` })),
};

const none: ExtractedRequest = {
  itemText: null, varietyText: null, quantityKg: null, dateText: null, budgetYen: null, budgetIncludesHandoverFee: null, budgetUnlimited: null,
  originText: null, handoverText: null, preferredProducerText: null, producerRequired: null, allowFirstTime: null, allowIrregular: null,
  allowMixedVarieties: null, allowMixedGrades: null,
};
// デモの文章「10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK」の正常な抽出結果
const demo: ExtractedRequest = {
  ...none, itemText: "トマト", quantityKg: 10, dateText: "10月23日金曜", budgetYen: 8000, budgetIncludesHandoverFee: true,
  originText: "大阪", preferredProducerText: "A農園", allowFirstTime: true,
};
const resolve = (o: Partial<ExtractedRequest>) => resolveExtraction({ ...none, ...o }, catalog, NOW);

describe("入力文・AI 出力の検証", () => {
  it("A: 空欄は受け付けない（AI を呼ぶ前に止める）", () => {
    expect(parseRequestText({ text: "" }).ok).toBe(false);
    expect(parseRequestText({ text: "   \n " }).ok).toBe(false);
    expect(parseRequestText({}).ok).toBe(false);
  });

  it("B: 1,000文字を超える入力は拒否する", () => {
    expect(parseRequestText({ text: "あ".repeat(1000) }).ok).toBe(true);
    expect(parseRequestText({ text: "あ".repeat(1001) }).ok).toBe(false);
  });

  it("C: 正常な AI 出力は検証を通る（欠けた項目は null とみなす）", () => {
    const r = parseExtraction(demo);
    expect(r.ok && r.value).toEqual(demo);
    const partial = parseExtraction({ itemText: "トマト" });
    expect(partial.ok && partial.value.quantityKg).toBeNull();
  });

  it("D: スキーマ外の項目（ID・農家選択・価格など）を返したら抽出失敗", () => {
    expect(parseExtraction({ ...demo, itemId: "demo-item-tomato" }).ok).toBe(false);
    expect(parseExtraction({ ...demo, recommendedProducer: "D農園" }).ok).toBe(false);
    expect(parseExtraction({ ...demo, totalYen: 6550 }).ok).toBe(false);
    expect(parseExtraction([demo]).ok).toBe(false);
    expect(parseExtraction("トマト10kg").ok).toBe(false);
  });

  it("E: 不正な値（quantity=abc・小数・範囲外・型違い・長すぎる文字列）は抽出失敗", () => {
    for (const bad of [{ quantityKg: "abc" }, { quantityKg: 2.5 }, { quantityKg: 0 }, { quantityKg: 101 }, { budgetYen: -1 },
      { budgetYen: "8000" }, { allowFirstTime: "yes" }, { itemText: 123 }, { itemText: "ト".repeat(101) }])
      expect(parseExtraction({ ...demo, ...bad }).ok).toBe(false);
  });
});

describe("登録データへの照合（resolve）", () => {
  it("デモの文章：品目・数量・日付・予算・産地・優先・初回可は確定。受渡枠・規格外・混在は利用者に確認させる", () => {
    const r = resolveExtraction(demo, catalog, NOW);
    expect(r.draft).toMatchObject({
      itemId: "demo-item-tomato", varietyId: null, quantityKg: 10, desiredDate: "2026-10-23", budget: { mode: "limit", yen: 8000 },
      originPrefectures: ["大阪府"], slotId: null, allowFirstTime: true, allowIrregular: null, preferredProducerId: "demo-producer-a",
    });
    expect(r.unresolvedFields).toEqual(["slotId", "allowIrregular", "allowMixedVarieties", "allowMixedGrades"]);
    // 受渡枠は自動で選ばず、その日の枠を候補として出すだけ
    expect(r.candidateMatches.slotId?.map((c) => c.label)).toEqual(["G-P", "G-Q"]);
  });

  it("I': カタカナ・ひらがなの違いは同じ品目として解決する（「ナス」→ なす、「とまと」→ トマト）", () => {
    expect(resolve({ itemText: "とまと" }).draft.itemId).toBe("demo-item-tomato");
    const withNasu: Catalog = { ...catalog, items: [...catalog.items, { id: "item-nasu", name: "なす", varieties: [{ id: "v-nasu", name: "指定なし" }] }] };
    for (const t of ["ナス", "なす", "ﾅｽ"]) expect(resolveExtraction({ ...none, itemText: t }, withNasu, NOW).draft.itemId).toBe("item-nasu");
    expect(resolveExtraction({ ...none, itemText: "キュウリ" }, withNasu, NOW).draft.itemId).toBeNull(); // 登録のない品目は解決しない
  });

  it("I: 「トマト」は登録済みの品目 ID に通常処理で解決する（全角・空白も吸収）", () => {
    expect(resolve({ itemText: "トマト" }).draft.itemId).toBe("demo-item-tomato");
    expect(resolve({ itemText: " トマト " }).draft.itemId).toBe("demo-item-tomato");
  });

  it("J: 登録されていない品目は ID を作らず未解決にする", () => {
    const r = resolve({ itemText: "メロン" });
    expect(r.draft.itemId).toBeNull();
    expect(r.unresolvedFields).toContain("itemId");
    expect(r.notices).toContain("ITEM_NOT_FOUND");
  });

  it("K: 「A農園」は登録済みの取引経験のある農家に解決する。初回農家・未登録・必須指定は確定しない", () => {
    expect(resolve({ preferredProducerText: "A農園" }).draft.preferredProducerId).toBe("demo-producer-a");
    expect(resolve({ preferredProducerText: "Ａ農園" }).draft.preferredProducerId).toBe("demo-producer-a");
    const first = resolve({ preferredProducerText: "B農園" });
    expect(first.draft.preferredProducerId).toBeNull();
    expect(first.notices).toContain("PRODUCER_NOT_PRIOR_TRADE");
    expect(resolve({ preferredProducerText: "Z農園" }).notices).toContain("PRODUCER_NOT_FOUND");
    const required = resolve({ preferredProducerText: "A農園", producerRequired: true });
    expect(required.draft.preferredProducerId).toBeNull(); // 「必須」を勝手に「優先」へ弱めない
    expect(required.notices).toContain("PRODUCER_REQUIRED_UNSUPPORTED");
    expect(required.unresolvedFields).toContain("preferredProducerId");
  });

  it("L: 「金曜」は DEMO_NOW（10/22 木）基準で 10/23 を候補にする。AI に日付を推測させない", () => {
    expect(dateCandidates("金曜", NOW).dates).toEqual(["2026-10-23"]);
    expect(dateCandidates("今週金曜", NOW).dates).toEqual(["2026-10-23"]);
    expect(dateCandidates("10月23日", NOW).dates).toEqual(["2026-10-23"]);
    expect(dateCandidates("10月23日金曜", NOW)).toEqual({ dates: ["2026-10-23"], weekdayMismatch: false });
    expect(dateCandidates("来週の金曜", NOW).dates).toEqual(["2026-10-30"]);
    expect(dateCandidates("明日", NOW).dates).toEqual(["2026-10-23"]);
    // 今日と同じ曜日は「今日か翌週か」が曖昧なので両方を候補にして確認させる
    const thu = resolve({ dateText: "木曜" });
    expect(thu.candidateMatches.desiredDate?.map((c) => c.id)).toEqual(["2026-10-22", "2026-10-29"]);
    expect(thu.draft.desiredDate).toBeNull();
    expect(thu.notices).toContain("DATE_AMBIGUOUS");
    // 日付と曜日が食い違えば確定しない
    const mismatch = resolve({ dateText: "10月23日木曜" });
    expect(mismatch.draft.desiredDate).toBeNull();
    expect(mismatch.notices).toContain("DATE_WEEKDAY_MISMATCH");
    expect(resolve({ dateText: "そのうち" }).notices).toContain("DATE_NOT_UNDERSTOOD");
  });

  it("M: 「大阪産」は産地（originPrefectures）。受渡枠には入れない", () => {
    for (const t of ["大阪", "大阪産", "大阪府", "大阪府産"]) {
      const r = resolve({ originText: t });
      expect(r.draft.originPrefectures).toEqual(["大阪府"]);
      expect(r.draft.slotId).toBeNull();
    }
    expect(resolve({ originText: "大阪・京都" }).draft.originPrefectures).toEqual(["大阪府", "京都府"]);
    // 「大阪近郊」はあいまいなので府県を選ばせる
    const near = resolve({ originText: "大阪近郊" });
    expect(near.draft.originPrefectures).toEqual([]);
    expect(near.notices).toContain("ORIGIN_AMBIGUOUS");
  });

  it("N: 「大阪で受取」は受渡枠（場所）側として扱い、産地には入れない", () => {
    const r = resolve({ handoverText: "大阪で受取", dateText: "10月23日" });
    expect(r.draft.originPrefectures).toEqual([]);
    expect(r.unresolvedFields).toContain("originPrefectures");
    // 大阪府内の枠が2つある → 自動で選ばず候補から選ばせる
    expect(r.draft.slotId).toBeNull();
    expect(r.candidateMatches.slotId?.map((c) => c.id)).toEqual(["demo-slot-gp", "demo-slot-gq"]);
    expect(r.notices).toContain("HANDOVER_AMBIGUOUS");
    // 拠点名で一意に決まれば候補を確定（それでも確認画面で変更できる）
    expect(resolve({ handoverText: "拠点Pで受け取り", dateText: "10月23日" }).draft.slotId).toBe("demo-slot-gp");
  });

  it("予算：受渡費込みの金額だけ確定。「商品代のみ」は確認させ、「上限なし」は明記された場合だけ", () => {
    expect(resolve({ budgetYen: 8000, budgetIncludesHandoverFee: false }).draft.budget).toBeNull();
    expect(resolve({ budgetYen: 8000, budgetIncludesHandoverFee: false }).notices).toContain("BUDGET_EXCLUDES_FEE");
    expect(resolve({ budgetUnlimited: true }).draft.budget).toEqual({ mode: "none" });
    expect(resolve({}).draft.budget).toBeNull(); // 書かれていなければ推測しない
  });

  it("文章に書かれていない判断（初回可否・規格外・混在）は null のまま未確定にする", () => {
    const r = resolve({ itemText: "トマト" });
    expect(r.draft).toMatchObject({ allowFirstTime: null, allowIrregular: null, allowMixedVarieties: null, allowMixedGrades: null });
    expect(r.unresolvedFields).toEqual(expect.arrayContaining(["allowFirstTime", "allowIrregular", "allowMixedVarieties", "allowMixedGrades", "budget", "slotId"]));
  });
});

describe("確認画面 → /api/plan", () => {
  it("O: AI 抽出後に利用者が変更した値が /api/plan に送られる", () => {
    const form = formFromDraft(resolveExtraction(demo, catalog, NOW).draft);
    expect(missingFields(form)).toEqual(["slotId", "allowIrregular", "allowMixedVarieties", "allowMixedGrades"]);
    // 利用者が数量を 8kg に、予算を上限なしに変え、未確定の項目を選ぶ
    const edited = { ...form, quantityKg: "8", budgetMode: "none" as const, slotId: "demo-slot-gp", allowIrregular: "no" as const, allowMixedVarieties: "no" as const, allowMixedGrades: "no" as const };
    expect(missingFields(edited)).toEqual([]);
    const body = toPlanBody(edited);
    expect(body).toMatchObject({ quantityKg: "8", budgetYen: null, slotId: "demo-slot-gp", allowIrregular: false, preferredProducerId: "demo-producer-a" });
    const parsed = parsePlanRequest(body, NOW);
    expect(parsed.ok && parsed.value).toMatchObject({ quantityKg: 8, budgetYen: null, desiredDate: "2026-10-23", originPrefectures: ["大阪府"], allowFirstTime: true });
  });

  it("未確定の項目が残ったまま送ってもサーバーで拒否される（勝手に false にしない）", () => {
    const form = formFromDraft(resolveExtraction(demo, catalog, NOW).draft);
    expect(parsePlanRequest(toPlanBody({ ...form, slotId: "demo-slot-gp" }), NOW).ok).toBe(false);
  });
});
