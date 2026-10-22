import { isValidDate, jstDate } from "./dates.js";

// 生産者が登録する「受け渡し可能地点」（普段の出荷・移動のついでに受け渡せる場所）。
// 新しい配送を求めるものではない。登録するのは場所（種類・名前・住所）だけで、曜日・時間は持たない。
// 渡せる日と時間帯（午前／午後）は出品のときに選び、その日時の受渡の回（HandoverSlot）を使う（なければ作る）。
// 仕入れ案の計算・依頼の仕組みは今までの受渡の回のまま（生産者の場所の受け渡し費用は 0 円）。

export const PLACE_KINDS = [
  { value: "direct_store", label: "直売所" },
  { value: "collection_point", label: "集荷場" },
  { value: "shipping_destination", label: "出荷先" },
  { value: "farm", label: "農園" },
  { value: "other", label: "その他" },
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number]["value"];
/** 画面に出す種類の名前。「その他」は分類のためだけに使い、画面には出さない（場所の名前だけを見せる） */
export const placeKindLabel = (k: string | null | undefined) => (k === "other" ? null : PLACE_KINDS.find((x) => x.value === k)?.label ?? null);

/** 生産者に「どこで渡せますか？」と聞くときの選択肢（普段していることとして聞く） */
export const PRODUCER_KIND_CHOICES: { value: PlaceKind; label: string }[] = [
  { value: "direct_store", label: "いつもの直売所" },
  { value: "collection_point", label: "いつもの集荷場所" },
  { value: "shipping_destination", label: "いつもの出荷先" },
  { value: "farm", label: "自分の農園" },
  { value: "other", label: "その他" },
];
/** 種類のない場所（はじめから用意されている受け渡し場所）は「その他」として扱う */
export const kindOrOther = (k: string | null | undefined): PlaceKind => (PLACE_KINDS.some((x) => x.value === k) ? (k as PlaceKind) : "other");

export const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"] as const;
export const PICKUP_LIMITS = { name: 40, address: 100, note: 100, perProducer: 5 } as const;

export type PickupPointInput = { name: string; address: string; kind: PlaceKind; note: string | null };
type Field = keyof PickupPointInput;
export type PickupResult = { ok: true; value: PickupPointInput } | { ok: false; error: string; field: Field };
export type ExistingPlaceResult = { ok: true; value: { placeId: string } } | { ok: false; error: string; field: "placeId" };

/** すでにある場所を「いつもの場所」にする：場所だけ（曜日・時間は聞かない。渡せる日と時間帯は出品のときに選ぶ） */
export function parseExistingPlace(body: unknown): ExistingPlaceResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const placeId = typeof b.placeId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.placeId) ? b.placeId : null;
  if (!placeId) return { ok: false, field: "placeId", error: "場所を選んでください" };
  return { ok: true, value: { placeId } };
}

// ── 出品のときの受け渡し：いつもの場所＋渡せる日＋時間帯（午前／午後）。細かい時刻はマッチング後のやり取りで決める ──

export const HANDOVER_PERIODS = [
  { value: "am", label: "午前", startTime: "09:00", endTime: "12:00" },
  { value: "pm", label: "午後", startTime: "13:00", endTime: "17:00" },
] as const;
export type HandoverPeriod = (typeof HANDOVER_PERIODS)[number]["value"];
/** 確認の締切：受け渡し開始の何時間前か（生産者が登録した場所の受け渡し。毎週の枠と同じ） */
export const HANDOVER_DEADLINE_HOURS = 17;
/** 何日先まで選べるか */
export const HANDOVER_DAYS_AHEAD = 14;
export const periodLabel = (p: HandoverPeriod) => {
  const x = HANDOVER_PERIODS.find((h) => h.value === p)!;
  return `${x.label}（${x.startTime.replace(/^0/, "")}〜${x.endTime}）`;
};

/** 日本時間の日付と時間帯 → 受け渡しの開始・終了・確認の締切 */
export function handoverWindow(date: string, period: HandoverPeriod) {
  const p = HANDOVER_PERIODS.find((h) => h.value === period)!;
  const startAt = new Date(`${date}T${p.startTime}:00+09:00`);
  return { startAt, endAt: new Date(`${date}T${p.endTime}:00+09:00`), confirmDeadlineAt: new Date(startAt.getTime() - HANDOVER_DEADLINE_HOURS * 3600_000) };
}

/** 今から選べる「渡せる日」と、その日に選べる時間帯（確認の締切が過ぎていないもの） */
export function handoverChoices(now: Date): { date: string; periods: HandoverPeriod[] }[] {
  const out: { date: string; periods: HandoverPeriod[] }[] = [];
  for (let d = 0; d <= HANDOVER_DAYS_AHEAD; d++) {
    const date = jstDate(d, now);
    const periods = HANDOVER_PERIODS.map((p) => p.value).filter((p) => handoverWindow(date, p).confirmDeadlineAt.getTime() > now.getTime());
    if (periods.length > 0) out.push({ date, periods });
  }
  return out;
}

export type HandoverInput = { placeId: string; date: string; period: HandoverPeriod };
/** 出品のときの受け渡し（場所・日・時間帯）を確かめる（画面とサーバーで同じ規則） */
export function parseHandover(body: unknown, now: Date): { ok: true; value: HandoverInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const placeId = typeof b.placeId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.placeId) ? b.placeId : null;
  if (!placeId) return { ok: false, error: "受け渡しの場所を選んでください" };
  const date = typeof b.date === "string" && isValidDate(b.date) ? b.date : null;
  if (!date) return { ok: false, error: "渡せる日を選んでください" };
  const period = HANDOVER_PERIODS.find((h) => h.value === b.period)?.value;
  if (!period) return { ok: false, error: "渡せる時間帯を選んでください" };
  if (!handoverChoices(now).some((c) => c.date === date && c.periods.includes(period))) return { ok: false, error: "その日・時間帯は選べません。選び直してください" };
  return { ok: true, value: { placeId, date, period } };
}

/** 受け渡し可能地点の入力を確かめる（画面とサーバーで同じ規則） */
export function parsePickupPoint(body: unknown): PickupResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(b.name), address = str(b.address), note = str(b.note);
  if (!name) return { ok: false, field: "name", error: "場所の名前を入れてください" };
  if (name.length > PICKUP_LIMITS.name) return { ok: false, field: "name", error: `場所の名前は${PICKUP_LIMITS.name}文字以内にしてください` };
  if (!address) return { ok: false, field: "address", error: "住所を入れてください" };
  if (address.length > PICKUP_LIMITS.address) return { ok: false, field: "address", error: `住所は${PICKUP_LIMITS.address}文字以内にしてください` };
  const kind = PLACE_KINDS.find((k) => k.value === b.kind)?.value;
  if (!kind) return { ok: false, field: "kind", error: "どこで渡せるかを選んでください" };
  if (note.length > PICKUP_LIMITS.note) return { ok: false, field: "note", error: `補足は${PICKUP_LIMITS.note}文字以内で入力してください` };
  return { ok: true, value: { name, address, kind, note: note || null } };
}

/** 参加する受渡枠の選択肢の説明。生産者が登録した地点は種類と「受け渡し費用なし」、運営の拠点は従来どおり受渡料金 */
export function seriesSub(s: { weekday: number; startTime: string; endTime: string; feeYen: number; placeKind?: string | null }, when: string): string {
  const kind = placeKindLabel(s.placeKind);
  return kind ? `${kind}・${when}・受け渡し費用なし` : `${when}・受渡料金 ${s.feeYen.toLocaleString("ja-JP")}円`;
}

/** 例：毎週金曜 16:00〜18:00 */
export const weeklyText = (s: { weekday: number; startTime: string; endTime: string }) => `毎週${WEEKDAY_LABEL[s.weekday]}曜 ${s.startTime}〜${s.endTime}`;
