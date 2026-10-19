import { PREFECTURES } from "./constants.js";

// 一般ユーザーの初回登録（オンボーディング）で使う選択肢・入力の確認・「スタイル」の要約。
// 画面とサーバーの両方でこのファイルを使う（画面での確認は案内のため。最終的な確認はサーバーで必ず行う）。
// 選択肢の値は DB の enum（prisma/schema.prisma）と同じ。AI は使わない。

type Option<V extends string> = { value: V; label: string; sub?: string };
const values = <V extends string>(opts: readonly Option<V>[]) => opts.map((o) => o.value);
export const labelOf = <V extends string>(opts: readonly Option<V>[], v: V | "" | null | undefined) => opts.find((o) => o.value === v)?.label ?? "";

// ── 飲食店 ─────────────────────────────────────────
export const BUSINESS_TYPES = [
  { value: "japanese", label: "和食" }, { value: "izakaya", label: "居酒屋" }, { value: "italian", label: "イタリアン" },
  { value: "french", label: "フレンチ" }, { value: "cafe", label: "カフェ" }, { value: "bakery", label: "パン・ベーカリー" },
  { value: "chinese", label: "中華" }, { value: "western", label: "洋食" }, { value: "other", label: "その他" },
] as const satisfies readonly Option<string>[];
export const PURCHASE_FREQUENCIES = [
  { value: "almost_daily", label: "ほぼ毎日" }, { value: "few_times_weekly", label: "週2〜3回" },
  { value: "weekly", label: "週1回程度" }, { value: "as_needed", label: "必要なときだけ" },
] as const satisfies readonly Option<string>[];
export const PURCHASE_VOLUMES = [
  { value: "small", label: "少量中心", sub: "5kgより少ないことが多い" }, { value: "kg5_10", label: "5〜10kg程度" },
  { value: "kg10_30", label: "10〜30kg程度" }, { value: "kg30_plus", label: "30kg以上" },
] as const satisfies readonly Option<string>[];
export const IRREGULAR_POLICIES = [
  { value: "welcome", label: "積極的に使いたい" }, { value: "depends", label: "条件による" }, { value: "avoid", label: "基本的には使わない" },
] as const satisfies readonly Option<string>[];
export const FIRST_TIME_POLICIES = [
  { value: "include", label: "新しい農家も候補に入れる" }, { value: "prefer_known", label: "取引経験のある農家を優先したい" },
] as const satisfies readonly Option<string>[];
export const PICKUP_TIMES = [
  { value: "early_morning", label: "早朝" }, { value: "morning", label: "午前" }, { value: "afternoon", label: "午後" },
  { value: "evening", label: "夕方" }, { value: "any", label: "特にこだわらない" },
] as const satisfies readonly Option<string>[];
export const PURCHASE_PRIORITIES = [
  { value: "local", label: "地元・近さ" }, { value: "freshness", label: "鮮度" }, { value: "price", label: "価格" },
  { value: "stable_supply", label: "安定供給" }, { value: "small_lots", label: "少量対応" }, { value: "use_irregular", label: "規格外活用" },
  { value: "rare_items", label: "珍しい食材" }, { value: "direct_connection", label: "生産者とのつながり" },
] as const satisfies readonly Option<string>[];
export const PRIORITY_MAX = 3;

type V<T extends readonly Option<string>[]> = T[number]["value"];
export type BusinessType = V<typeof BUSINESS_TYPES>;
export type PurchaseFrequency = V<typeof PURCHASE_FREQUENCIES>;
export type PurchaseVolume = V<typeof PURCHASE_VOLUMES>;
export type IrregularPolicy = V<typeof IRREGULAR_POLICIES>;
export type FirstTimePolicy = V<typeof FIRST_TIME_POLICIES>;
export type PickupTime = V<typeof PICKUP_TIMES>;
export type PurchasePriority = V<typeof PURCHASE_PRIORITIES>;

/** 画面の入力（すべて文字列・配列。未選択は ""） */
export type RestaurantForm = {
  name: string; businessType: BusinessType | ""; businessTypeOther: string; prefecture: string; city: string; address: string; phone: string;
  purchaseFrequency: PurchaseFrequency | ""; purchaseVolume: PurchaseVolume | "";
  irregularPolicy: IrregularPolicy | ""; firstTimePolicy: FirstTimePolicy | ""; pickupTimes: PickupTime[]; priorities: PurchasePriority[];
};
export const EMPTY_RESTAURANT: RestaurantForm = {
  name: "", businessType: "", businessTypeOther: "", prefecture: "", city: "", address: "", phone: "",
  purchaseFrequency: "", purchaseVolume: "", irregularPolicy: "", firstTimePolicy: "", pickupTimes: [], priorities: [],
};
/** 保存する値（確認・正規化済み） */
export type RestaurantProfile = {
  name: string; businessType: BusinessType; businessTypeOther: string | null; prefecture: string; city: string; address: string | null; phone: string | null;
  purchaseFrequency: PurchaseFrequency; purchaseVolume: PurchaseVolume; irregularPolicy: IrregularPolicy; firstTimePolicy: FirstTimePolicy;
  pickupTimes: PickupTime[]; priorities: PurchasePriority[];
};
export type RestaurantField = keyof RestaurantForm;
export const RESTAURANT_STEPS: { title: string; fields: RestaurantField[] }[] = [
  { title: "お店について", fields: ["name", "businessType", "businessTypeOther", "prefecture", "city", "address", "phone"] },
  { title: "普段の仕入れ", fields: ["purchaseFrequency", "purchaseVolume"] },
  { title: "仕入れの希望", fields: ["irregularPolicy", "firstTimePolicy", "pickupTimes", "priorities"] },
  { title: "確認", fields: [] },
];

// ── 生産者 ─────────────────────────────────────────
export const PRODUCTION_STYLES = [
  { value: "many_small", label: "少量多品目", sub: "いろいろな野菜を少しずつ" }, { value: "specialized", label: "特定品目中心", sub: "決まった品目をまとまった量で" },
  { value: "seasonal", label: "季節中心", sub: "季節によって作るものが変わる" }, { value: "other", label: "その他" },
] as const satisfies readonly Option<string>[];
export const SALES_CHANNELS = [
  { value: "market", label: "市場" }, { value: "ja", label: "JA" }, { value: "direct_store", label: "直売所" },
  { value: "restaurant", label: "飲食店との直接取引" }, { value: "ec", label: "EC（ネット販売）" }, { value: "other", label: "その他" },
] as const satisfies readonly Option<string>[];
export const DIRECT_TRADE_EXPERIENCES = [
  { value: "often", label: "よくある" }, { value: "sometimes", label: "経験あり" }, { value: "rarely", label: "少しだけ" }, { value: "never", label: "初めて" },
] as const satisfies readonly Option<string>[];
export const PRODUCER_CAPABILITIES = [
  { value: "small_lot", label: "少量対応", sub: "数kgの注文にも応じられる" }, { value: "irregular", label: "規格外品", sub: "形や大きさがそろわないものも出せる" },
  { value: "surplus", label: "余剰が出たときだけ", sub: "余った分があるときに出す" }, { value: "direct_talk", label: "飲食店との直接相談", sub: "量や受け取り方を相談できる" },
] as const satisfies readonly Option<string>[];

export type ProductionStyle = V<typeof PRODUCTION_STYLES>;
export type SalesChannel = V<typeof SALES_CHANNELS>;
export type DirectTradeExperience = V<typeof DIRECT_TRADE_EXPERIENCES>;
export type ProducerCapability = V<typeof PRODUCER_CAPABILITIES>;

export type ProducerForm = {
  farmName: string; producerName: string; prefecture: string; city: string;
  itemIds: string[]; otherCrops: string; productionStyle: ProductionStyle | ""; salesChannels: SalesChannel[]; directTradeExperience: DirectTradeExperience | "";
  capabilities: ProducerCapability[]; seriesIds: string[]; contactPhone: string; contactEmail: string;
};
export const EMPTY_PRODUCER: ProducerForm = {
  farmName: "", producerName: "", prefecture: "", city: "", itemIds: [], otherCrops: "", productionStyle: "", salesChannels: [], directTradeExperience: "",
  capabilities: [], seriesIds: [], contactPhone: "", contactEmail: "",
};
export type ProducerProfile = {
  farmName: string; producerName: string; prefecture: string; city: string; itemIds: string[]; otherCrops: string | null;
  productionStyle: ProductionStyle; salesChannels: SalesChannel[]; directTradeExperience: DirectTradeExperience;
  capabilities: ProducerCapability[]; seriesIds: string[]; contactPhone: string | null; contactEmail: string | null;
};
export type ProducerField = keyof ProducerForm;
export const PRODUCER_STEPS: { title: string; fields: ProducerField[] }[] = [
  { title: "農園について", fields: ["farmName", "producerName", "prefecture", "city"] },
  { title: "作っているもの・販売", fields: ["itemIds", "otherCrops", "productionStyle", "salesChannels", "directTradeExperience"] },
  // 受け渡しの場所は初回登録では聞かない（はじめて出品するときに「普段、野菜をどこで渡せますか？」と1回だけ聞く）
  { title: "できること", fields: ["capabilities"] },
  { title: "連絡先と確認", fields: ["contactPhone", "contactEmail"] },
];

// ── 入力の確認（画面・サーバー共通）─────────────────
export const LIMITS = { name: 60, businessTypeOther: 30, city: 40, address: 120, phone: 24, producerName: 40, otherCrops: 100, email: 254, arrayMax: 20 } as const;
const PHONE_RE = /^\+?[0-9 ()-]{6,24}$/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export const isPhone = (s: string) => PHONE_RE.test(s) && s.replace(/\D/g, "").length >= 6;
export const isEmail = (s: string) => s.length <= LIMITS.email && EMAIL_RE.test(s);

type Raw = Record<string, unknown>;
const str = (b: Raw, k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : b[k] === undefined || b[k] === null ? "" : null);
/** 配列は文字列だけ・重複を除いて、選んだ順を保つ。配列でない・文字列以外が入っていれば null */
const arr = (b: Raw, k: string): string[] | null => {
  const v = b[k] ?? [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return null;
  return [...new Set(v as string[])];
};
const oneOf = <T extends string>(allowed: readonly T[], v: string | null): v is T => v !== null && (allowed as readonly string[]).includes(v);
const allOf = <T extends string>(allowed: readonly T[], v: string[] | null): v is T[] => v !== null && v.every((x) => (allowed as readonly string[]).includes(x));
const requiredText = (v: string | null, label: string, max: number) =>
  v === null ? `${label}の形式が正しくありません` : !v ? `${label}を入力してください` : v.length > max ? `${label}は${max}文字以内にしてください` : null;
const optionalText = (v: string | null, label: string, max: number) =>
  v === null ? `${label}の形式が正しくありません` : v.length > max ? `${label}は${max}文字以内にしてください` : null;
const prefectureError = (v: string | null) => (!v ? "都道府県を選んでください" : oneOf(PREFECTURES, v) ? null : "都道府県を選び直してください");

export type Checked<F extends string, P> = { ok: true; value: P } | { ok: false; errors: Partial<Record<F, string>> };

export function checkRestaurant(body: unknown): Checked<RestaurantField, RestaurantProfile> {
  const b = (body && typeof body === "object" ? body : {}) as Raw;
  const e: Partial<Record<RestaurantField, string>> = {};
  const name = str(b, "name"), businessType = str(b, "businessType"), other = str(b, "businessTypeOther");
  const prefecture = str(b, "prefecture"), city = str(b, "city"), address = str(b, "address"), phone = str(b, "phone");
  const frequency = str(b, "purchaseFrequency"), volume = str(b, "purchaseVolume"), irregular = str(b, "irregularPolicy"), firstTime = str(b, "firstTimePolicy");
  const pickupTimes = arr(b, "pickupTimes"), priorities = arr(b, "priorities");

  const set = (f: RestaurantField, msg: string | null) => { if (msg) e[f] = msg; };
  set("name", requiredText(name, "店舗名", LIMITS.name));
  set("businessType", oneOf(values(BUSINESS_TYPES), businessType) ? null : "業態を選んでください");
  if (businessType === "other") set("businessTypeOther", requiredText(other, "業態", LIMITS.businessTypeOther));
  set("prefecture", prefectureError(prefecture));
  set("city", requiredText(city, "市区町村", LIMITS.city));
  set("address", optionalText(address, "詳しい住所", LIMITS.address));
  set("phone", phone === null ? "電話番号の形式が正しくありません" : phone && !isPhone(phone) ? "電話番号を確認してください（例：06-1234-5678）" : null);
  set("purchaseFrequency", oneOf(values(PURCHASE_FREQUENCIES), frequency) ? null : "仕入れの頻度を選んでください");
  set("purchaseVolume", oneOf(values(PURCHASE_VOLUMES), volume) ? null : "1回の仕入れ量を選んでください");
  set("irregularPolicy", oneOf(values(IRREGULAR_POLICIES), irregular) ? null : "規格外品についての考えを選んでください");
  set("firstTimePolicy", oneOf(values(FIRST_TIME_POLICIES), firstTime) ? null : "初めての農家についての考えを選んでください");
  if (!allOf(values(PICKUP_TIMES), pickupTimes)) set("pickupTimes", "受け取りの時間帯を選び直してください");
  else if (pickupTimes.includes("any") && pickupTimes.length > 1) set("pickupTimes", "「特にこだわらない」と時間帯は同時に選べません");
  if (!allOf(values(PURCHASE_PRIORITIES), priorities)) set("priorities", "大切にしたいことを選び直してください");
  else if (priorities.length > PRIORITY_MAX) set("priorities", `${PRIORITY_MAX}つまで選べます`);

  if (Object.keys(e).length > 0) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      name: name!, businessType: businessType as BusinessType, businessTypeOther: businessType === "other" ? other! : null,
      prefecture: prefecture!, city: city!, address: address || null, phone: phone || null,
      purchaseFrequency: frequency as PurchaseFrequency, purchaseVolume: volume as PurchaseVolume,
      irregularPolicy: irregular as IrregularPolicy, firstTimePolicy: firstTime as FirstTimePolicy,
      pickupTimes: pickupTimes as PickupTime[], priorities: priorities as PurchasePriority[],
    },
  };
}

/** 生産者。品目・受渡枠が実在するか（マスタ・有効な定期枠か）はサーバーが DB で確かめる */
export function checkProducer(body: unknown): Checked<ProducerField, ProducerProfile> {
  const b = (body && typeof body === "object" ? body : {}) as Raw;
  const e: Partial<Record<ProducerField, string>> = {};
  const farmName = str(b, "farmName"), producerName = str(b, "producerName"), prefecture = str(b, "prefecture"), city = str(b, "city");
  const itemIds = arr(b, "itemIds"), otherCrops = str(b, "otherCrops"), style = str(b, "productionStyle"), channels = arr(b, "salesChannels");
  const experience = str(b, "directTradeExperience"), capabilities = arr(b, "capabilities"), seriesIds = arr(b, "seriesIds");
  const phone = str(b, "contactPhone"), email = str(b, "contactEmail");

  const set = (f: ProducerField, msg: string | null) => { if (msg) e[f] = msg; };
  set("farmName", requiredText(farmName, "農園名", LIMITS.name));
  set("producerName", requiredText(producerName, "生産者名（担当者名）", LIMITS.producerName));
  set("prefecture", prefectureError(prefecture));
  set("city", requiredText(city, "市区町村", LIMITS.city));
  if (itemIds === null || itemIds.some((x) => !x || x.length > 64) || itemIds.length > LIMITS.arrayMax) set("itemIds", "作物を選び直してください");
  else if (itemIds.length === 0) set("itemIds", "主な作物を1つ以上選んでください");
  set("otherCrops", optionalText(otherCrops, "その他の作物", LIMITS.otherCrops));
  set("productionStyle", oneOf(values(PRODUCTION_STYLES), style) ? null : "生産のスタイルを選んでください");
  if (!allOf(values(SALES_CHANNELS), channels)) set("salesChannels", "販売先を選び直してください");
  set("directTradeExperience", oneOf(values(DIRECT_TRADE_EXPERIENCES), experience) ? null : "飲食店との直接取引の経験を選んでください");
  if (!allOf(values(PRODUCER_CAPABILITIES), capabilities)) set("capabilities", "対応できることを選び直してください");
  if (seriesIds === null || seriesIds.some((x) => !x || x.length > 64) || seriesIds.length > LIMITS.arrayMax) set("seriesIds", "受け渡しの場所を選び直してください");
  if (phone === null || email === null) set("contactPhone", "連絡先の形式が正しくありません");
  else if (!phone && !email) set("contactPhone", "電話番号かメールアドレスのどちらかを入力してください");
  else {
    if (phone && !isPhone(phone)) set("contactPhone", "電話番号を確認してください（例：090-1234-5678）");
    if (email && !isEmail(email)) set("contactEmail", "メールアドレスを確認してください（例：farm@example.com）");
  }

  if (Object.keys(e).length > 0) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      farmName: farmName!, producerName: producerName!, prefecture: prefecture!, city: city!, itemIds: itemIds!, otherCrops: otherCrops || null,
      productionStyle: style as ProductionStyle, salesChannels: channels as SalesChannel[], directTradeExperience: experience as DirectTradeExperience,
      capabilities: capabilities as ProducerCapability[], seriesIds: seriesIds!, contactPhone: phone || null, contactEmail: email || null,
    },
  };
}

/** その STEP に関係する誤りだけを取り出す（画面で「次へ」を押したとき用） */
export function stepErrors<F extends string>(errors: Partial<Record<F, string>>, fields: readonly F[]): Partial<Record<F, string>> {
  const out: Partial<Record<F, string>> = {};
  for (const f of fields) if (errors[f]) out[f] = errors[f];
  return out;
}

// ── スタイルの要約（選んだ内容から決まった規則で作る。保存はしない）──
// 規則：候補を決まった順に並べ、同じ意味のもの（例：「少量対応」を大切にする／1回の量が少量中心）は1つにまとめ、先頭から最大3つを「 × 」でつなぐ。
type Concept = { key: string; text: string };
const join = (cs: (Concept | null)[], fallback: string) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cs) {
    if (!c || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c.text);
    if (out.length === 3) break;
  }
  return out.length ? out.join(" × ") : fallback;
};

const PRIORITY_CONCEPT: Record<PurchasePriority, Concept> = {
  local: { key: "local", text: "地元産" }, freshness: { key: "fresh", text: "鮮度重視" }, price: { key: "price", text: "価格重視" },
  stable_supply: { key: "stable", text: "安定供給" }, small_lots: { key: "small", text: "少量仕入れ" }, use_irregular: { key: "irregular", text: "規格外OK" },
  rare_items: { key: "rare", text: "珍しい食材" }, direct_connection: { key: "direct", text: "生産者とつながる" },
};

const VOLUME_CONCEPT: Record<PurchaseVolume, Concept> = {
  small: { key: "small", text: "少量仕入れ" }, kg5_10: { key: "volume", text: "1回5〜10kg" },
  kg10_30: { key: "volume", text: "1回10〜30kg" }, kg30_plus: { key: "volume", text: "1回30kg以上" },
};
const FREQUENCY_CONCEPT: Record<PurchaseFrequency, Concept> = {
  almost_daily: { key: "freq", text: "ほぼ毎日仕入れ" }, few_times_weekly: { key: "freq", text: "週2〜3回仕入れ" },
  weekly: { key: "freq", text: "週1回仕入れ" }, as_needed: { key: "freq", text: "必要なときに仕入れ" },
};

/** 飲食店：大切にしたこと（選んだ順。選ばなくてもよい）→ 1回の量 → 規格外 → 初めての農家 → 頻度、の順で最大3つ。
 *  量・規格外・初めての農家・頻度は必須なので、大切にしたことが空でも必ず要約できる */
export function restaurantStyle(p: Pick<RestaurantForm, "priorities" | "purchaseVolume" | "irregularPolicy" | "firstTimePolicy" | "purchaseFrequency">): string {
  return join([
    ...p.priorities.map((x) => PRIORITY_CONCEPT[x] ?? null),
    p.purchaseVolume ? VOLUME_CONCEPT[p.purchaseVolume] : null,
    p.irregularPolicy === "welcome" ? { key: "irregular", text: "規格外OK" } : p.irregularPolicy === "avoid" ? { key: "irregular", text: "規格品中心" } : null,
    p.firstTimePolicy === "include" ? { key: "newfarm", text: "新しい農家も歓迎" } : p.firstTimePolicy === "prefer_known" ? { key: "newfarm", text: "なじみの農家優先" } : null,
    p.purchaseFrequency ? FREQUENCY_CONCEPT[p.purchaseFrequency] : null,
  ], "地域の食材を仕入れる");
}

/** 生産者：対応できること（少量→規格外→余剰→直接相談）→ 直接取引（販売先・経験）→ 生産スタイル、の順で最大3つ。
 *  対応できること・販売先は選ばなくてもよい */
export function producerStyle(p: Pick<ProducerForm, "capabilities" | "salesChannels" | "productionStyle" | "directTradeExperience">): string {
  const has = (c: ProducerCapability) => p.capabilities.includes(c);
  return join([
    has("small_lot") ? { key: "small", text: "少量対応" } : null,
    has("irregular") ? { key: "irregular", text: "規格外OK" } : null,
    has("surplus") ? { key: "surplus", text: "余剰品も出品" } : null,
    has("direct_talk") || p.salesChannels.includes("restaurant") ? { key: "direct", text: "直接取引OK" } : null,
    p.directTradeExperience === "often" || p.directTradeExperience === "sometimes" ? { key: "direct", text: "直接取引の経験あり" } : null,
    p.productionStyle === "many_small" ? { key: "style", text: "少量多品目" } : p.productionStyle === "specialized" ? { key: "style", text: "特定品目中心" } : p.productionStyle === "seasonal" ? { key: "style", text: "旬の野菜" } : null,
  ], "地域の野菜を届ける");
}

const WEEKDAYS = "日月火水木金土";
/** 定期の受渡枠を人が読める形に（例：毎週火曜日 10:00〜11:00） */
export const seriesWhen = (s: { weekday: number; startTime: string; endTime: string }) => `毎週${WEEKDAYS[s.weekday] ?? "?"}曜日 ${s.startTime}〜${s.endTime}`;
