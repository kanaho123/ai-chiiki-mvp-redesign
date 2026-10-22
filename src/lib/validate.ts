import { QUANTITY_KG_MAX, QUANTITY_KG_MIN, type PlanRequest } from "./allocate.js";
import { PREFECTURES } from "./constants.js";
import { isValidDate, jstDate } from "./dates.js";
import { parseItemName } from "./items.js";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return text(v, max) ?? undefined;
}

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

/** 予算の上限（税込円） */
export const BUDGET_YEN_MAX = 10_000_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const id = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const optionalId = (v: unknown): string | null | undefined => (v === undefined || v === null || v === "" ? null : id(v) ?? undefined);

/**
 * 利用者が確定した仕入れ条件をサーバー側で検証する（クライアントの検証だけに頼らない）。
 * 重要な選択（初回農家・規格外・混在）は true/false の明示が必要で、未選択のままでは計算しない。
 * 予算は数値か null（＝利用者が「上限なし」を選んだ）を明示する。未入力を上限なしとは扱わない。
 */
/**
 * 品種・規格を合わせてよいか（飲食店には聞かない）。
 * ・品種：品種を指定しなければ、どの品種でも合わせる。指定したら、その品種だけ
 * ・規格：「規格外も含める」なら通常品と合わせてよい。含めないなら、規格外はそもそも使わない
 */
export const mixingFor = (varietyId: string | null, allowIrregular: boolean) => ({ allowMixedVarieties: varietyId === null, allowMixedGrades: allowIrregular });

export function parsePlanRequest(body: unknown, now: Date): Result<PlanRequest> {
  if (!isObj(body)) return { ok: false, error: "条件を読み取れません" };

  const itemId = id(body.itemId);
  if (!itemId) return { ok: false, error: "品目を選択してください" };
  const varietyId = optionalId(body.varietyId);
  if (varietyId === undefined) return { ok: false, error: "品種を選び直してください" };
  const quantityKg = int(body.quantityKg, QUANTITY_KG_MIN, QUANTITY_KG_MAX);
  if (quantityKg === null) return { ok: false, error: `数量は${QUANTITY_KG_MIN}〜${QUANTITY_KG_MAX}kgの整数で入力してください` };
  const desiredDate = typeof body.desiredDate === "string" && isValidDate(body.desiredDate) ? body.desiredDate : null;
  if (!desiredDate) return { ok: false, error: "受け取りたい日を入力してください" };
  if (desiredDate < jstDate(0, now)) return { ok: false, error: "受け取りたい日に過去の日付は指定できません" };

  if (!("budgetYen" in body) || body.budgetYen === undefined || body.budgetYen === "")
    return { ok: false, error: "予算を入力するか「上限なし」を選んでください" };
  const budgetYen = body.budgetYen === null ? null : int(body.budgetYen, 1, BUDGET_YEN_MAX);
  if (body.budgetYen !== null && budgetYen === null)
    return { ok: false, error: `予算は1〜${BUDGET_YEN_MAX.toLocaleString("ja-JP")}円の整数で入力してください` };

  const origins = body.originPrefectures;
  if (!Array.isArray(origins) || origins.length === 0) return { ok: false, error: "産地（都道府県）を1つ以上選択してください" };
  if (!origins.every((o) => typeof o === "string" && (PREFECTURES as readonly string[]).includes(o)))
    return { ok: false, error: "産地の都道府県を選び直してください" };

  const slotId = id(body.slotId);
  if (!slotId) return { ok: false, error: "受渡枠（受取場所・日時）を選択してください" };

  // 品種・規格を「まぜてよいか」は飲食店に聞かない。送られていなければ決まった規則で決める（mixingFor）
  const flags = [
    ["allowFirstTime", "初回の農家を含めるか"],
    ["allowIrregular", "規格外を使えるか"],
  ] as const;
  for (const [key, label] of flags)
    if (typeof body[key] !== "boolean") return { ok: false, error: `${label}を選択してください` };

  const preferredProducerId = optionalId(body.preferredProducerId);
  if (preferredProducerId === undefined) return { ok: false, error: "優先する農家を選び直してください" };
  const mixing = mixingFor(varietyId, body.allowIrregular as boolean);

  return {
    ok: true,
    value: {
      itemId, varietyId, quantityKg, desiredDate, budgetYen,
      originPrefectures: [...new Set(origins as string[])],
      slotId,
      allowFirstTime: body.allowFirstTime as boolean,
      allowIrregular: body.allowIrregular as boolean,
      // 画面からは送らない（決まった規則で決める）。送られていれば、その値を使う：
      // 保存済みの相談の条件（以前は画面で選んでいた値）を読み直したときに、案の内容と fingerprint が変わらないように
      allowMixedVarieties: typeof body.allowMixedVarieties === "boolean" ? body.allowMixedVarieties : mixing.allowMixedVarieties,
      allowMixedGrades: typeof body.allowMixedGrades === "boolean" ? body.allowMixedGrades : mixing.allowMixedGrades,
      preferredProducerId,
    },
  };
}

// ---------------------------------------------------------------------------
// ログイン・供給（Supply）。数量は整数kg・0〜100、単価は税込整数円/kg
// ---------------------------------------------------------------------------

export const SUPPLY_KG_MAX = 100;
export const SUPPLY_PRICE_MAX = 100_000;
export const IRREGULAR_REASON_MAX = 30;

export function parseLogin(body: unknown): Result<{ loginId: string; password: string }> {
  if (!isObj(body)) return { ok: false, error: "ログイン情報を確認してください" };
  const loginId = typeof body.loginId === "string" ? body.loginId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(loginId) || password.length < 1 || password.length > 200)
    return { ok: false, error: "ログイン情報を確認してください" };
  return { ok: true, value: { loginId, password } };
}

export type SupplyPatch = { version: number; availableKg?: number; priceYenPerKg?: number; published?: boolean };

/**
 * 数量変更・価格変更・公開停止／再開。画面で開いた時点の version が必要（古ければ 409）。
 * どの変更でも version が +1 され、その在庫を使った仕入れ案・相談は「条件が変わりました」になる（既存の判定）。
 */
export function parseSupplyPatch(body: unknown): Result<SupplyPatch> {
  if (!isObj(body)) return { ok: false, error: "入力を読み取れません" };
  const version = int(body.version, 1, Number.MAX_SAFE_INTEGER);
  if (version === null) return { ok: false, error: "最新情報を読み込み直してください" };
  const patch: SupplyPatch = { version };
  if (body.availableKg !== undefined) {
    const kg = int(body.availableKg, 0, SUPPLY_KG_MAX);
    if (kg === null) return { ok: false, error: `販売可能量は0〜${SUPPLY_KG_MAX}kgの整数で入力してください` };
    patch.availableKg = kg;
  }
  if (body.priceYenPerKg !== undefined) {
    const price = int(body.priceYenPerKg, 1, SUPPLY_PRICE_MAX);
    if (price === null) return { ok: false, error: "税込単価は1円以上の整数（円/kg）で入力してください" };
    patch.priceYenPerKg = price;
  }
  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") return { ok: false, error: "公開状態が正しくありません" };
    patch.published = body.published;
  }
  if (patch.availableKg === undefined && patch.priceYenPerKg === undefined && patch.published === undefined) return { ok: false, error: "変更内容がありません" };
  return { ok: true, value: patch };
}

export type SupplyInput = {
  /** 既存の品目を選んだとき（品種も選ぶ）。新しい品目名を入れたときは null で itemName を使う */
  itemId: string | null;
  varietyId: string | null;
  /** 新しい品目名（itemId がないとき）。照合の鍵で既存の品目を探し、なければサーバーで作る（一般向けの環境だけ） */
  itemName: string | null;
  grade: "regular" | "irregular";
  irregularReason: string | null;
  originPrefecture: string;
  availableKg: number;
  priceYenPerKg: number;
  minKg: number;
  slotId: string;
  published: boolean;
};

/** 新しい供給。生産者は入力させず、ログイン中の生産者に紐付ける（API 側で設定） */
export function parseSupplyInput(body: unknown): Result<SupplyInput> {
  if (!isObj(body)) return { ok: false, error: "入力を読み取れません" };
  // 品目：既存の品目（itemId と品種）か、入力した品目名（itemName）のどちらか
  const itemId = id(body.itemId);
  let varietyId: string | null = null, itemName: string | null = null;
  if (itemId) {
    varietyId = id(body.varietyId);
    if (!varietyId) return { ok: false, error: "品種を選択してください" };
  } else {
    const n = parseItemName(body.itemName);
    if (!n.ok) return { ok: false, error: n.error };
    itemName = n.name;
  }
  const grade = oneOf(body.grade, ["regular", "irregular"] as const);
  if (!grade) return { ok: false, error: "規格（通常品／規格外）を選択してください" };
  // 規格外の理由は任意（生産者の入力の負担を減らす）。空欄なら null。書いた場合だけ長さを確かめる
  const reasonText = grade === "irregular" && typeof body.irregularReason === "string" ? body.irregularReason.trim() : "";
  if (reasonText.length > IRREGULAR_REASON_MAX) return { ok: false, error: `規格外の理由は${IRREGULAR_REASON_MAX}文字以内で入力してください` };
  const irregularReason = reasonText || null;
  const originPrefecture = oneOf(body.originPrefecture, PREFECTURES);
  if (!originPrefecture) return { ok: false, error: "産地（都道府県）を選択してください" };
  const availableKg = int(body.availableKg, 0, SUPPLY_KG_MAX);
  if (availableKg === null) return { ok: false, error: `販売可能量は0〜${SUPPLY_KG_MAX}kgの整数で入力してください` };
  const priceYenPerKg = int(body.priceYenPerKg, 1, SUPPLY_PRICE_MAX);
  if (priceYenPerKg === null) return { ok: false, error: "税込単価は1円以上の整数（円/kg）で入力してください" };
  const minKg = int(body.minKg, 1, SUPPLY_KG_MAX);
  if (minKg === null) return { ok: false, error: `最低販売量は1〜${SUPPLY_KG_MAX}kgの整数で入力してください` };
  const slotId = id(body.slotId);
  if (!slotId) return { ok: false, error: "受渡枠を選択してください" };
  if (typeof body.published !== "boolean") return { ok: false, error: "公開するかを選択してください" };
  return {
    ok: true,
    value: { itemId, varietyId, itemName, grade, irregularReason, originPrefecture, availableKg, priceYenPerKg, minKg, slotId, published: body.published },
  };
}

// ---------------------------------------------------------------------------
// 自然文の条件抽出（AI）。AI の出力は信用せず、ここで厳密に検証する
// ---------------------------------------------------------------------------

export const REQUEST_TEXT_MAX = 1000;
export const EXTRACT_TEXT_FIELD_MAX = 100;

/** AI が返してよい項目。文章に無いものは null。ID・計算結果・推薦は含めない */
export type ExtractedRequest = {
  itemText: string | null;
  varietyText: string | null;
  quantityKg: number | null;
  dateText: string | null;
  budgetYen: number | null;
  budgetIncludesHandoverFee: boolean | null; // 「受渡費込み」と書かれていれば true、「商品代のみ」なら false
  budgetUnlimited: boolean | null; // 「予算上限なし」と明記されていれば true
  originText: string | null; // 産地（「大阪産」など）
  handoverText: string | null; // 受取場所・受渡枠（「拠点Pで受取」「大阪で受け取り」など）
  preferredProducerText: string | null;
  producerRequired: boolean | null; // 「A農園必須」「絶対」など強い指定なら true
  allowFirstTime: boolean | null;
  allowIrregular: boolean | null;
  allowMixedVarieties: boolean | null;
  allowMixedGrades: boolean | null;
};

export const EXTRACTED_KEYS = [
  "itemText", "varietyText", "quantityKg", "dateText", "budgetYen", "budgetIncludesHandoverFee", "budgetUnlimited",
  "originText", "handoverText", "preferredProducerText", "producerRequired", "allowFirstTime", "allowIrregular",
  "allowMixedVarieties", "allowMixedGrades",
] as const satisfies readonly (keyof ExtractedRequest)[];

const TEXT_KEYS = ["itemText", "varietyText", "dateText", "originText", "handoverText", "preferredProducerText"] as const;
const BOOL_KEYS = ["budgetIncludesHandoverFee", "budgetUnlimited", "producerRequired", "allowFirstTime", "allowIrregular", "allowMixedVarieties", "allowMixedGrades"] as const;

/** 利用者の入力文（空欄・1,000文字超は AI を呼ばずに拒否） */
export function parseRequestText(body: unknown): Result<string> {
  if (!isObj(body) || typeof body.text !== "string") return { ok: false, error: "仕入れたい内容を入力してください" };
  const text = body.text.trim();
  if (!text) return { ok: false, error: "仕入れたい内容を入力してください" };
  if (text.length > REQUEST_TEXT_MAX) return { ok: false, error: `${REQUEST_TEXT_MAX.toLocaleString("ja-JP")}文字以内で入力してください` };
  return { ok: true, value: text };
}

/**
 * AI の出力を検証する。スキーマ外の項目・型違い・範囲外の値が1つでもあれば抽出失敗とする
 * （一部だけ信用して使うことはしない）。項目が欠けている場合は null（文章に無い）とみなす。
 */
export function parseExtraction(raw: unknown): Result<ExtractedRequest> {
  const fail = { ok: false as const, error: "AIの出力が想定と異なります" };
  if (!isObj(raw) || Array.isArray(raw)) return fail;
  if (Object.keys(raw).some((k) => !(EXTRACTED_KEYS as readonly string[]).includes(k))) return fail;
  const out = Object.fromEntries(EXTRACTED_KEYS.map((k) => [k, null])) as ExtractedRequest;

  for (const k of TEXT_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" || v.length > EXTRACT_TEXT_FIELD_MAX) return fail;
    out[k] = v.trim() || null;
  }
  for (const k of BOOL_KEYS) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "boolean") return fail;
    out[k] = v;
  }
  if (raw.quantityKg !== undefined && raw.quantityKg !== null) {
    if (typeof raw.quantityKg !== "number" || !Number.isInteger(raw.quantityKg) || raw.quantityKg < QUANTITY_KG_MIN || raw.quantityKg > QUANTITY_KG_MAX) return fail;
    out.quantityKg = raw.quantityKg;
  }
  if (raw.budgetYen !== undefined && raw.budgetYen !== null) {
    if (typeof raw.budgetYen !== "number" || !Number.isInteger(raw.budgetYen) || raw.budgetYen < 1 || raw.budgetYen > BUDGET_YEN_MAX) return fail;
    out.budgetYen = raw.budgetYen;
  }
  return { ok: true, value: out };
}
