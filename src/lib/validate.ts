import { QUANTITY_KG_MAX, QUANTITY_KG_MIN, type PlanRequest } from "./allocate.js";
import { IRREGULAR_REASONS, LIMITS, PREFECTURES, REGIONS, UNITS } from "./constants.js";
import { isValidDate, isValidTime, jstDate } from "./dates.js";

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

  const flags = [
    ["allowFirstTime", "初回の農家を含めるか"],
    ["allowIrregular", "規格外を使えるか"],
    ["allowMixedVarieties", "品種の混在を許可するか"],
    ["allowMixedGrades", "通常品と規格外の混在を許可するか"],
  ] as const;
  for (const [key, label] of flags)
    if (typeof body[key] !== "boolean") return { ok: false, error: `${label}を選択してください` };

  const preferredProducerId = optionalId(body.preferredProducerId);
  if (preferredProducerId === undefined) return { ok: false, error: "優先する農家を選び直してください" };

  return {
    ok: true,
    value: {
      itemId, varietyId, quantityKg, desiredDate, budgetYen,
      originPrefectures: [...new Set(origins as string[])],
      slotId,
      allowFirstTime: body.allowFirstTime as boolean,
      allowIrregular: body.allowIrregular as boolean,
      allowMixedVarieties: body.allowMixedVarieties as boolean,
      allowMixedGrades: body.allowMixedGrades as boolean,
      preferredProducerId,
    },
  };
}

export type ListingInput = {
  // 既存の生産者は ID で指定し、新しい生産者は名前で作る（名前は重複してよい）
  producer: { id: string } | { name: string };
  item: string;
  variety: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  availableDate: string;
  region: string;
  irregularReason: string | null;
  handoverPlace: string;
  handoverStart: string;
  handoverEnd: string;
  minQuantity: number;
  step: number;
  handoverFee: number;
};

export function parseListingInput(body: unknown): Result<ListingInput> {
  if (!isObj(body)) return { ok: false, error: "入力を読み取れません" };
  let producer: ListingInput["producer"];
  if (typeof body.producerId === "string" && body.producerId !== "") {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(body.producerId)) return { ok: false, error: "生産者を選び直してください" };
    producer = { id: body.producerId };
  } else {
    const name = text(body.producerName, LIMITS.textMax);
    if (!name) return { ok: false, error: `生産者名を${LIMITS.textMax}文字以内で入力してください` };
    producer = { name };
  }
  const item = text(body.item, LIMITS.textMax);
  if (!item) return { ok: false, error: `品目を${LIMITS.textMax}文字以内で入力してください` };
  const variety = optionalText(body.variety, LIMITS.textMax);
  if (variety === undefined) return { ok: false, error: `品種は${LIMITS.textMax}文字以内で入力してください` };
  const availableDate = typeof body.availableDate === "string" && isValidDate(body.availableDate) ? body.availableDate : null;
  if (!availableDate) return { ok: false, error: "販売可能日を入力してください" };
  if (availableDate < jstDate()) return { ok: false, error: "販売可能日に過去の日付は指定できません" };
  const region = oneOf(body.region, REGIONS);
  if (!region) return { ok: false, error: "地域を選択してください" };
  const quantity = int(body.quantity, 0, LIMITS.quantityMax);
  if (quantity === null) return { ok: false, error: `販売可能量は0〜${LIMITS.quantityMax}の整数で入力してください` };
  const unit = oneOf(body.unit, UNITS);
  if (!unit) return { ok: false, error: "単位を選択してください" };
  const unitPrice = int(body.unitPrice, 0, LIMITS.priceMax);
  if (unitPrice === null) return { ok: false, error: "税込単価は0以上の整数（円）で入力してください" };
  const handoverPlace = text(body.handoverPlace, LIMITS.placeMax);
  if (!handoverPlace) return { ok: false, error: "受渡場所を入力してください" };
  const handoverStart = typeof body.handoverStart === "string" && isValidTime(body.handoverStart) ? body.handoverStart : null;
  const handoverEnd = typeof body.handoverEnd === "string" && isValidTime(body.handoverEnd) ? body.handoverEnd : null;
  if (!handoverStart || !handoverEnd || handoverStart >= handoverEnd)
    return { ok: false, error: "受渡時間を正しく入力してください（開始は終了より前）" };
  const minQuantity = int(body.minQuantity, 1, LIMITS.quantityMax);
  if (minQuantity === null) return { ok: false, error: "最低販売量は1以上の整数で入力してください" };
  const step = int(body.step, 1, LIMITS.quantityMax);
  if (step === null) return { ok: false, error: "販売刻みは1以上の整数で入力してください" };
  const handoverFee = int(body.handoverFee ?? 0, 0, LIMITS.priceMax);
  if (handoverFee === null) return { ok: false, error: "受渡手数料は0以上の整数（円）で入力してください" };
  const irregularReason =
    body.irregularReason === null || body.irregularReason === "" || body.irregularReason === undefined
      ? null
      : oneOf(body.irregularReason, IRREGULAR_REASONS);
  if (irregularReason === null && body.irregularReason) return { ok: false, error: "規格外理由を選択してください" };

  return {
    ok: true,
    value: {
      producer, item, variety, quantity, unit, unitPrice, availableDate, region, irregularReason,
      handoverPlace, handoverStart, handoverEnd, minQuantity, step, handoverFee,
    },
  };
}

export function parseListingPatch(body: unknown): Result<{ quantity?: number; isPublic?: boolean }> {
  if (!isObj(body)) return { ok: false, error: "入力を読み取れません" };
  const patch: { quantity?: number; isPublic?: boolean } = {};
  if (body.quantity !== undefined) {
    const q = int(body.quantity, 0, LIMITS.quantityMax);
    if (q === null) return { ok: false, error: `販売可能量は0〜${LIMITS.quantityMax}の整数で入力してください` };
    patch.quantity = q;
  }
  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== "boolean") return { ok: false, error: "公開状態が正しくありません" };
    patch.isPublic = body.isPublic;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "変更内容がありません" };
  return { ok: true, value: patch };
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

export type SupplyPatch = { version: number; availableKg?: number; published?: boolean };

/** 数量変更・公開停止／再開。画面で開いた時点の version が必要（古ければ 409） */
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
  if (body.published !== undefined) {
    if (typeof body.published !== "boolean") return { ok: false, error: "公開状態が正しくありません" };
    patch.published = body.published;
  }
  if (patch.availableKg === undefined && patch.published === undefined) return { ok: false, error: "変更内容がありません" };
  return { ok: true, value: patch };
}

export type SupplyInput = {
  itemId: string;
  varietyId: string;
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
  const itemId = id(body.itemId);
  if (!itemId) return { ok: false, error: "品目を選択してください" };
  const varietyId = id(body.varietyId);
  if (!varietyId) return { ok: false, error: "品種を選択してください" };
  const grade = oneOf(body.grade, ["regular", "irregular"] as const);
  if (!grade) return { ok: false, error: "規格（通常品／規格外）を選択してください" };
  const irregularReason = grade === "irregular" ? text(body.irregularReason, IRREGULAR_REASON_MAX) : null;
  if (grade === "irregular" && !irregularReason) return { ok: false, error: `規格外の理由を${IRREGULAR_REASON_MAX}文字以内で入力してください` };
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
    value: { itemId, varietyId, grade, irregularReason, originPrefecture, availableKg, priceYenPerKg, minKg, slotId, published: body.published },
  };
}
