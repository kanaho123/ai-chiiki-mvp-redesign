import { describe, expect, it } from "vitest";
import * as E from "./generated/prisma/enums.js";
import {
  BUSINESS_TYPES, checkProducer, checkRestaurant, DIRECT_TRADE_EXPERIENCES, EMPTY_PRODUCER, EMPTY_RESTAURANT, FIRST_TIME_POLICIES, IRREGULAR_POLICIES,
  PICKUP_TIMES, PRODUCER_CAPABILITIES, producerStyle, PRODUCTION_STYLES, PURCHASE_FREQUENCIES, PURCHASE_PRIORITIES, PURCHASE_VOLUMES,
  restaurantStyle, SALES_CHANNELS, seriesWhen,
} from "../src/lib/onboarding.js";

// 初回登録の選択肢・入力の確認・スタイルの要約の規則（画面とサーバーで共通のもの）

describe("選択肢の値は DB の enum と同じ", () => {
  it.each([
    [BUSINESS_TYPES, E.BusinessType], [PURCHASE_FREQUENCIES, E.PurchaseFrequency], [PURCHASE_VOLUMES, E.PurchaseVolume],
    [IRREGULAR_POLICIES, E.IrregularPolicy], [FIRST_TIME_POLICIES, E.FirstTimePolicy], [PICKUP_TIMES, E.PickupTime],
    [PURCHASE_PRIORITIES, E.PurchasePriority], [PRODUCTION_STYLES, E.ProductionStyle], [SALES_CHANNELS, E.SalesChannel],
    [DIRECT_TRADE_EXPERIENCES, E.DirectTradeExperience], [PRODUCER_CAPABILITIES, E.ProducerCapability],
  ])("%#", (options, dbEnum) => {
    expect(options.map((o) => o.value).sort()).toEqual(Object.values(dbEnum).sort());
    for (const o of options) expect(o.label.length).toBeGreaterThan(0);
  });
});

describe("あなたの仕入れスタイル（飲食店）", () => {
  const base = { ...EMPTY_RESTAURANT, purchaseVolume: "kg10_30", irregularPolicy: "depends", firstTimePolicy: "prefer_known", purchaseFrequency: "weekly" } as const;
  it("例：地元・近さを大切に＋少量中心＋規格外を積極的に → 地元産 × 少量仕入れ × 規格外OK", () => {
    expect(restaurantStyle({ priorities: ["local"], purchaseVolume: "small", irregularPolicy: "welcome", firstTimePolicy: "prefer_known", purchaseFrequency: "weekly" })).toBe("地元産 × 少量仕入れ × 規格外OK");
  });
  it("大切にしたことは選んだ順で、最大3つ", () => {
    expect(restaurantStyle({ ...base, priorities: ["price", "freshness", "rare_items"] })).toBe("価格重視 × 鮮度重視 × 珍しい食材");
  });
  it("同じ意味のものは1つにまとめる（少量対応を大切に＋少量中心）", () => {
    expect(restaurantStyle({ ...base, priorities: ["small_lots"], purchaseVolume: "small" })).toBe("少量仕入れ × なじみの農家優先 × 週1回仕入れ");
    expect(restaurantStyle({ ...base, priorities: ["use_irregular"], irregularPolicy: "welcome", firstTimePolicy: "include" })).toBe("規格外OK × 1回10〜30kg × 新しい農家も歓迎");
  });
  it("大切にしたいことを選ばなくても、必須の回答（量・規格外・初めての農家・頻度）から決まった形で作る", () => {
    expect(restaurantStyle({ ...base, priorities: [] })).toBe("1回10〜30kg × なじみの農家優先 × 週1回仕入れ");
    expect(restaurantStyle({ priorities: [], purchaseVolume: "small", irregularPolicy: "welcome", firstTimePolicy: "include", purchaseFrequency: "almost_daily" })).toBe("少量仕入れ × 規格外OK × 新しい農家も歓迎");
    expect(restaurantStyle({ priorities: [], purchaseVolume: "kg30_plus", irregularPolicy: "avoid", firstTimePolicy: "include", purchaseFrequency: "as_needed" })).toBe("1回30kg以上 × 規格品中心 × 新しい農家も歓迎");
  });
  it("入力がまったくないとき（画面の途中）の表示", () => {
    expect(restaurantStyle({ ...EMPTY_RESTAURANT })).toBe("地域の食材を仕入れる");
  });
  it("同じ入力なら、いつも同じ結果", () => {
    const p = { ...base, priorities: ["direct_connection", "stable_supply"] as ("direct_connection" | "stable_supply")[] };
    expect(restaurantStyle(p)).toBe(restaurantStyle({ ...p }));
  });
});

describe("あなたの販売スタイル（生産者）", () => {
  it("例：少量対応・規格外・直接相談 → 少量対応 × 規格外OK × 直接取引OK", () => {
    expect(producerStyle({ capabilities: ["direct_talk", "irregular", "small_lot"], salesChannels: [], productionStyle: "seasonal", directTradeExperience: "never" })).toBe("少量対応 × 規格外OK × 直接取引OK");
  });
  it("飲食店と直接取引している販売先も「直接取引OK」。足りなければ生産スタイルで補う", () => {
    expect(producerStyle({ capabilities: [], salesChannels: ["market", "restaurant"], productionStyle: "many_small", directTradeExperience: "often" })).toBe("直接取引OK × 少量多品目");
    expect(producerStyle({ capabilities: ["surplus"], salesChannels: ["ja"], productionStyle: "seasonal", directTradeExperience: "rarely" })).toBe("余剰品も出品 × 旬の野菜");
  });
  it("販売先・対応できることを選ばなくても、経験・生産スタイルから作る", () => {
    expect(producerStyle({ capabilities: [], salesChannels: [], productionStyle: "specialized", directTradeExperience: "sometimes" })).toBe("直接取引の経験あり × 特定品目中心");
  });
  it("何も当てはまらないときの表示", () => {
    expect(producerStyle({ capabilities: [], salesChannels: [], productionStyle: "other", directTradeExperience: "never" })).toBe("地域の野菜を届ける");
  });
});

describe("入力の確認の細かい規則", () => {
  const r = { ...EMPTY_RESTAURANT, name: "店", businessType: "cafe", prefecture: "京都府", city: "京都市", purchaseFrequency: "weekly", purchaseVolume: "small", irregularPolicy: "avoid", firstTimePolicy: "include", pickupTimes: ["any"], priorities: ["price"] };
  it("「特にこだわらない」だけなら通る。時間帯と一緒なら通らない。どちらも選ばなくても通る", () => {
    expect(checkRestaurant(r).ok).toBe(true);
    expect(checkRestaurant({ ...r, pickupTimes: [], priorities: [] }).ok).toBe(true);
    expect(checkRestaurant({ ...r, pickupTimes: ["evening", "any"] }).ok).toBe(false);
  });
  it("重複した選択は1つにまとめる（4件送っても重複を除いて3件なら通る）", () => {
    const c = checkRestaurant({ ...r, priorities: ["price", "price", "local", "freshness"] });
    expect(c.ok && c.value.priorities).toEqual(["price", "local", "freshness"]);
  });
  it("知らない項目は保存する値に入らない", () => {
    const c = checkRestaurant({ ...r, onboardedAt: "x", ownerUserId: "y" });
    expect(c.ok && Object.keys(c.value)).not.toContain("ownerUserId");
  });
  it("生産者の連絡先：どちらか1つで通る。電話番号の形式・メールの形式は確かめる", () => {
    const p = { ...EMPTY_PRODUCER, farmName: "農園", producerName: "名", prefecture: "奈良県", city: "奈良市", itemIds: ["i"], productionStyle: "other", salesChannels: ["ec"], directTradeExperience: "never", seriesIds: ["s"] };
    expect(checkProducer({ ...p, contactEmail: "a@b.jp" }).ok).toBe(true);
    expect(checkProducer({ ...p, contactEmail: "a@b.jp", salesChannels: [] }).ok).toBe(true); // 販売先は任意
    expect(checkProducer({ ...p, contactEmail: "a@b.jp", itemIds: [] }).ok).toBe(false); // 主な作物は1つ以上
    expect(checkProducer({ ...p, contactEmail: "a@b.jp", seriesIds: [] }).ok).toBe(true); // 受け渡しの場所は任意（はじめての出品のときに聞く）
    expect(checkProducer({ ...p, contactPhone: "06-1234-5678" }).ok).toBe(true);
    expect(checkProducer({ ...p }).ok).toBe(false);
    expect(checkProducer({ ...p, contactPhone: "12" }).ok).toBe(false);
    expect(checkProducer({ ...p, contactEmail: "a@b" }).ok).toBe(false);
  });
  it("定期の受渡枠の表示", () => {
    expect(seriesWhen({ weekday: 2, startTime: "10:00", endTime: "11:00" })).toBe("毎週火曜日 10:00〜11:00");
  });
});
