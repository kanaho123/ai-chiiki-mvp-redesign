import { isValidTime } from "./dates.js";

// 生産者が登録する「受け渡し可能地点」（普段の出荷・移動のついでに受け渡せる場所）。
// 新しい配送を求めるものではない。登録した地点は、既存の受渡の場所（Place）と毎週の受渡枠（SlotSeries）として保存し、
// 既存の受渡の回・出品・仕入れ案の計算の仕組みをそのまま使う（受け渡し費用は 0 円）。

export const PLACE_KINDS = [
  { value: "direct_store", label: "直売所" },
  { value: "collection_point", label: "集荷場" },
  { value: "shipping_destination", label: "出荷先" },
  { value: "farm", label: "農園" },
  { value: "other", label: "その他" },
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number]["value"];
export const placeKindLabel = (k: string | null | undefined) => PLACE_KINDS.find((x) => x.value === k)?.label ?? null;

export const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"] as const;
export const PICKUP_LIMITS = { name: 40, address: 100, note: 100, perProducer: 5 } as const;

export type PickupPointInput = {
  name: string; address: string; kind: PlaceKind; weekday: number; startTime: string; endTime: string; note: string | null;
};
type Field = keyof PickupPointInput;
export type PickupResult = { ok: true; value: PickupPointInput } | { ok: false; error: string; field: Field };

/** 受け渡し可能地点の入力を確かめる（画面とサーバーで同じ規則） */
export function parsePickupPoint(body: unknown): PickupResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(b.name), address = str(b.address), note = str(b.note);
  if (!name) return { ok: false, field: "name", error: "地点名を入力してください" };
  if (name.length > PICKUP_LIMITS.name) return { ok: false, field: "name", error: `地点名は${PICKUP_LIMITS.name}文字以内で入力してください` };
  if (!address) return { ok: false, field: "address", error: "住所を入力してください" };
  if (address.length > PICKUP_LIMITS.address) return { ok: false, field: "address", error: `住所は${PICKUP_LIMITS.address}文字以内で入力してください` };
  const kind = PLACE_KINDS.find((k) => k.value === b.kind)?.value;
  if (!kind) return { ok: false, field: "kind", error: "地点の種類を選んでください" };
  const weekday = typeof b.weekday === "number" ? b.weekday : typeof b.weekday === "string" && b.weekday !== "" ? Number(b.weekday) : NaN;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, field: "weekday", error: "受け渡しできる曜日を選んでください" };
  const startTime = str(b.startTime), endTime = str(b.endTime);
  if (!isValidTime(startTime)) return { ok: false, field: "startTime", error: "開始の時刻を入力してください（例：16:00）" };
  if (!isValidTime(endTime)) return { ok: false, field: "endTime", error: "終了の時刻を入力してください（例：18:00）" };
  if (endTime <= startTime) return { ok: false, field: "endTime", error: "終了の時刻は開始より後にしてください" };
  if (note.length > PICKUP_LIMITS.note) return { ok: false, field: "note", error: `補足は${PICKUP_LIMITS.note}文字以内で入力してください` };
  return { ok: true, value: { name, address, kind, weekday, startTime, endTime, note: note || null } };
}

/** 参加する受渡枠の選択肢の説明。生産者が登録した地点は種類と「受け渡し費用なし」、運営の拠点は従来どおり受渡料金 */
export function seriesSub(s: { weekday: number; startTime: string; endTime: string; feeYen: number; placeKind?: string | null }, when: string): string {
  const kind = placeKindLabel(s.placeKind);
  return kind ? `${kind}・${when}・受け渡し費用なし` : `${when}・受渡料金 ${s.feeYen.toLocaleString("ja-JP")}円`;
}

/** 例：毎週金曜 16:00〜18:00 */
export const weeklyText = (s: { weekday: number; startTime: string; endTime: string }) => `毎週${WEEKDAY_LABEL[s.weekday]}曜 ${s.startTime}〜${s.endTime}`;
