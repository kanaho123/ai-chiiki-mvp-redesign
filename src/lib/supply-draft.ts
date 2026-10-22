import { parseItemName } from "./items.js";
import { SUPPLY_KG_MAX, SUPPLY_PRICE_MAX } from "./validate.js";

// 生産者の出品の下書き（写真・話した内容 → AI → 品目・量・価格・規格の候補）の入力と出力の確認（画面とサーバーで共通）。
// AI の出力は下書きにすぎない：形が合わない値は捨てて null にし、生産者が画面で確かめて直してから、今までの出品の API で登録する。

export const DRAFT_TEXT_MAX = 300;
/** 写真（data URL）の上限。画面で長い辺 1024px の JPEG に縮めてから送るので、ふつうは 300KB 程度 */
export const DRAFT_IMAGE_MAX = 1_500_000;
const IMAGE_PREFIX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export type SupplyDraft = { itemName: string | null; availableKg: number | null; priceYenPerKg: number | null; grade: "regular" | "irregular" | null };
export type DraftInput = { text: string | null; image: string | null };

/** 画面から届いた入力（話した内容の文字か、写真の data URL。どちらか1つは必要） */
export function parseDraftInput(raw: unknown): { ok: true; value: DraftInput } | { ok: false; error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  const image = typeof b.image === "string" ? b.image : "";
  if (text.length > DRAFT_TEXT_MAX) return { ok: false, error: `話した内容は${DRAFT_TEXT_MAX}文字以内にしてください` };
  if (image && (image.length > DRAFT_IMAGE_MAX || !IMAGE_PREFIX.test(image))) return { ok: false, error: "写真を読み込めませんでした。もう一度撮ってください" };
  if (!text && !image) return { ok: false, error: "写真を撮るか、話して入力してください" };
  return { ok: true, value: { text: text || null, image: image || null } };
}

const intIn = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * AI の出力を下書きにする。形が合わない値は null（推測で埋めない）。何も読み取れなければ null。
 * 写真だけの入力（文字がない）では、写真から判断してよい品目だけを残し、数量・価格・規格は AI が返しても捨てる
 * （数量・価格は、話した内容・文字に「5kg」「1kg300円」のように書かれているときだけ下書きに入れる）
 */
export function parseSupplyDraft(raw: unknown, input?: DraftInput): SupplyDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const photoOnly = !!input && !input.text;
  const name = typeof r.itemName === "string" ? parseItemName(r.itemName) : null;
  const draft: SupplyDraft = {
    itemName: name?.ok ? name.name : null,
    availableKg: photoOnly ? null : intIn(r.availableKg, 1, SUPPLY_KG_MAX), // 出品と同じ上限。0kg は下書きにしない
    priceYenPerKg: photoOnly ? null : intIn(r.priceYenPerKg, 1, SUPPLY_PRICE_MAX),
    grade: photoOnly ? null : r.grade === "regular" || r.grade === "irregular" ? r.grade : null,
  };
  return Object.values(draft).every((v) => v === null) ? null : draft;
}
