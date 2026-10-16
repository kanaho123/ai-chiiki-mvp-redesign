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
