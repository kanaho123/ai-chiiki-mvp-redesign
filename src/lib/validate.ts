import type { PlanRequest } from "./allocate.js";
import { IRREGULAR_REASONS, LIMITS, REGIONS, UNITS } from "./constants.js";
import { isValidDate, isValidTime, jstDate } from "./dates.js";

/** 仕入れ案の希望数量の上限（配分計算の量を抑えるため） */
export const REQUEST_QUANTITY_MAX = 1000;

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

function optionalInt(v: unknown, min: number, max: number): number | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return int(v, min, max) ?? undefined;
}

function optionalTime(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && isValidTime(v) ? v : undefined;
}

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

export function parsePlanRequest(body: unknown): Result<PlanRequest> {
  if (!isObj(body)) return { ok: false, error: "条件を読み取れません" };
  if (!body.item && !body.quantity && !body.deadline) return { ok: false, error: "品目・数量・希望日を入力してください" };

  const item = text(body.item, LIMITS.textMax);
  if (!item) return { ok: false, error: `品目を${LIMITS.textMax}文字以内で入力してください` };
  const variety = optionalText(body.variety, LIMITS.textMax);
  if (variety === undefined) return { ok: false, error: `品種は${LIMITS.textMax}文字以内で入力してください` };
  const quantity = int(body.quantity, 1, REQUEST_QUANTITY_MAX);
  if (quantity === null) return { ok: false, error: `数量は1〜${REQUEST_QUANTITY_MAX}の整数で入力してください` };
  const unit = oneOf(body.unit, UNITS);
  if (!unit) return { ok: false, error: "単位を選択してください" };
  const deadline = typeof body.deadline === "string" && isValidDate(body.deadline) ? body.deadline : null;
  if (!deadline) return { ok: false, error: "希望日を入力してください" };
  if (deadline < jstDate()) return { ok: false, error: "希望日に過去の日付は指定できません" };
  const region = oneOf(body.region, REGIONS);
  if (!region) return { ok: false, error: "地域を選択してください" };
  if (typeof body.allowIrregular !== "boolean") return { ok: false, error: "規格外可否を選択してください" };

  const maxUnitPrice = optionalInt(body.maxUnitPrice, 1, LIMITS.priceMax);
  if (maxUnitPrice === undefined) return { ok: false, error: "税込単価の上限は1以上の整数（円）で入力してください" };
  const handoverPlace = optionalText(body.handoverPlace, LIMITS.placeMax);
  if (handoverPlace === undefined) return { ok: false, error: `受渡場所は${LIMITS.placeMax}文字以内で入力してください` };
  const handoverFrom = optionalTime(body.handoverFrom);
  const handoverTo = optionalTime(body.handoverTo);
  if (handoverFrom === undefined || handoverTo === undefined) return { ok: false, error: "受渡時間の形式が正しくありません" };
  if (handoverFrom && handoverTo && handoverFrom >= handoverTo)
    return { ok: false, error: "受渡時間の開始は終了より前にしてください" };

  return {
    ok: true,
    value: { item, variety, quantity, unit, deadline, region, allowIrregular: body.allowIrregular, maxUnitPrice, handoverPlace, handoverFrom, handoverTo },
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
