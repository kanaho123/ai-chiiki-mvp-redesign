// 飲食店からの「生産者への確認依頼」（ApprovalRequest）を、画面でふつうの言葉で表すための共通処理。
// ・状態の言葉：「承認」「NG」などのシステム用語は使わず、「対応できます」「今回は対応できません」で表す
// ・飲食店側は、同じ仕入れ案（planFingerprint）への依頼をまとめて「1つの相談」として扱う
// ・「条件が変わりました」（stale）は、在庫や条件が変わってその依頼がもう使えない状態（サーバーが毎回計算し直して判定する）

export type ConfirmationStatus = "pending" | "approved" | "rejected" | "stale";
export type Confirmation = {
  id: string; supplyId: string; producerName: string; restaurantName: string;
  planFingerprint: string; itemName: string; quantityKg: number; priceYenPerKg: number; subtotalYen: number;
  pickupStartAt: string; pickupEndAt: string; pickupPlace: string;
  status: ConfirmationStatus; createdAt: string;
  /** 依頼のときに保存した仕入れ条件（相手に見せてよいものだけ）。古いデータなどで読めなければ null */
  conditions?: RequestConditions | null;
  /** 取引の成立：同じ仕入れ案の全農家が「対応できます」。成立後は計算し直さず、保存した内容で固定する */
  established?: boolean;
  /** 受け取り完了（＝取引完了）の日時。まだなら null */
  receivedAt?: string | null;
};
/** 取引のやり取り（テキストだけ） */
export type TradeMessage = { id: string; body: string; createdAt: string; mine: boolean; sender: "restaurant" | "producer"; senderName: string };
/** 飲食店の仕入れ条件（依頼のときの planRequest から）。requestedKg は飲食店が必要な全体の量（この農家への相談量は quantityKg） */
export type RequestConditions = {
  requestedKg: number; desiredDate: string; originPrefectures: string[];
  allowIrregular: boolean | null; allowFirstTime: boolean | null; allowMixedVarieties: boolean | null; allowMixedGrades: boolean | null;
};
export type Contact = { contactPhone: string | null; contactEmail: string | null };

/** 取引後の評価（受け取り完了後に、飲食店・生産者がそれぞれ1回）。今は本人にだけ見せる */
export type TradeRating = "good" | "bad";
export const TRADE_RATINGS = [{ value: "good", label: "良かった" }, { value: "bad", label: "残念だった" }] as const satisfies readonly { value: TradeRating; label: string }[];
export const REVIEW_COMMENT_MAX = 100;
export type MyReview = { rating: TradeRating; comment: string | null; createdAt: string };
/** 取引1件（飲食店 × 農家）の評価の状態。usual は飲食店だけ（その農家を「いつもの農家」に登録済みか）。生産者には null */
export type TradeReviewState = { review: MyReview | null; usual: boolean | null };

/** 相談カードに並べる仕入れ条件（ふつうの言葉で） */
export function conditionChips(c: RequestConditions): { label: string; value: string }[] {
  const yesNo = (v: boolean | null) => (v === null ? null : v ? "可" : "不可");
  const rows: [string, string | null][] = [
    ["規格外", yesNo(c.allowIrregular)],
    ["初めての農家", yesNo(c.allowFirstTime)],
    ["産地", c.originPrefectures.length ? c.originPrefectures.join("・") : null],
    // 品種・規格の「まぜ」は飲食店が選ぶ条件ではない（品種の指定・規格外の可否から決まる）ので出さない
  ];
  return rows.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
}

/** 農家ごとの状態 */
export const confirmationLabel: Record<ConfirmationStatus, string> = {
  pending: "返事待ち", approved: "対応できます", rejected: "今回は対応できません", stale: "条件が変わりました",
};

/** 1つの相談（仕入れ案）全体の状態 */
export type ConsultationStatus = "waiting" | "accepted" | "partial" | "declined" | "stale" | "completed";
export const consultationLabel: Record<ConsultationStatus, string> = {
  waiting: "返事待ち", accepted: "マッチ成立", partial: "一部対応できません", declined: "今回は対応できません", stale: "条件が変わりました", completed: "取引完了",
};
/** 1農家でも「対応できません」のとき（自動で組み直しはしない） */
export const TRADE_DECLINED = "1農家が対応できないため、この仕入れ案では取引できません。仕入れ案を作り直してください。";
/** 受け取り完了の前の確認 */
export const RECEIVE_CONFIRM = "商品を実際に受け取りましたか？完了するとこの取引は完了済みになります。";

/** マッチ成立の近くに必ず添える文 */
export const NOT_AN_ORDER = "これは注文確定ではありません。在庫の確保も行われません。";
/** 在庫・条件が変わって、相談をもう一度確認する必要があるときの文 */
export const STALE_RECHECK = "在庫や条件が変わったため、現在の条件でもう一度確認が必要です。仕入れ案を計算し直して、改めて相談してください。";

/** 規則：条件が変わった農家が1つでもあれば「条件が変わりました」→ 全員が対応できない → 一部が対応できない → 全員対応できる（受け取り完了なら取引完了）→ それ以外は返事待ち */
export function consultationStatus(rows: Pick<Confirmation, "status" | "receivedAt">[]): ConsultationStatus {
  if (rows.some((r) => r.status === "stale")) return "stale";
  if (rows.length > 0 && rows.every((r) => r.status === "approved" && r.receivedAt)) return "completed";
  if (rows.length > 0 && rows.every((r) => r.status === "rejected")) return "declined";
  if (rows.some((r) => r.status === "rejected")) return "partial";
  if (rows.length > 0 && rows.every((r) => r.status === "approved")) return "accepted";
  return "waiting";
}

/**
 * マッチ成立：仕入れ案に含まれる全農家が「対応できます」で、条件が変わっていない（consultationStatus が accepted）ときだけ。
 * 一部の農家だけの返事は「成立」とまとめず、農家ごとの状態で見せる。
 */
export const isMatched = (rows: Pick<Confirmation, "status" | "receivedAt">[]) => rows.length > 0 && consultationStatus(rows) === "accepted";

/** 「A農園・B農園」（同じ農家は1回だけ） */
export const farmNames = (rows: Pick<Confirmation, "producerName">[]) => [...new Set(rows.map((r) => r.producerName))].join("・");

/** マッチ成立の説明（例：A農園・B農園と、数量・価格・受け渡し条件がそろいました） */
export const matchMessage = (rows: Pick<Confirmation, "producerName">[]) => `${farmNames(rows)}と、数量・価格・受け渡し条件がそろいました`;

export function overallConfirmation(rows: Confirmation[]): string {
  if (rows.length === 0) return "まだ依頼していません";
  const status = consultationStatus(rows);
  // 返事待ちのあいだは、何農家が返事をしたかだけを事実として添える（「一部成立」とはまとめない）
  const answered = rows.filter((r) => r.status !== "pending").length;
  if (status === "waiting" && answered > 0) return `返事待ち（${answered}/${rows.length}農家が回答済み）`;
  return consultationLabel[status];
}

export type Consultation = {
  id: string; // planFingerprint
  itemName: string; totalKg: number; subtotalYen: number;
  pickupStartAt: string; pickupEndAt: string; pickupPlace: string; createdAt: string;
  status: ConsultationStatus; farms: Confirmation[];
};

/** 飲食店の依頼を、仕入れ案ごとの相談にまとめる（新しい相談が先） */
export function groupConsultations(rows: Confirmation[]): Consultation[] {
  const groups = new Map<string, Confirmation[]>();
  for (const r of rows) groups.set(r.planFingerprint, [...(groups.get(r.planFingerprint) ?? []), r]);
  return [...groups.entries()].map(([id, farms]) => {
    const sorted = [...farms].sort((a, b) => a.producerName.localeCompare(b.producerName, "ja"));
    const first = sorted[0];
    return {
      id, itemName: first.itemName,
      totalKg: sorted.reduce((s, r) => s + r.quantityKg, 0), subtotalYen: sorted.reduce((s, r) => s + r.subtotalYen, 0),
      pickupStartAt: first.pickupStartAt, pickupEndAt: first.pickupEndAt, pickupPlace: first.pickupPlace,
      createdAt: sorted.map((r) => r.createdAt).sort().at(-1)!,
      status: consultationStatus(sorted), farms: sorted,
    };
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id)));
}

/**
 * 相談の進み具合（既存の依頼の状態だけから決める。新しい状態は保存しない）。
 * 相談送信済み → 生産者回答待ち → マッチ成立 → 受け渡し待ち → 取引完了（受け取り完了の日時があるとき）。
 * 条件が変わった・対応できない農家がいる相談は、この流れでは表さない（null。画面は従来どおり状態のタグと案内を出す）。
 */
export type ProgressStep = { key: "sent" | "answer" | "matched" | "handover" | "completed"; label: string; state: "done" | "current" | "todo" };
export function consultationProgress(c: Pick<Consultation, "status" | "farms" | "pickupStartAt">, now: Date): { steps: ProgressStep[]; current: string } | null {
  if (c.status !== "waiting" && c.status !== "accepted" && c.status !== "completed") return null;
  const completed = c.status === "completed";
  const matched = c.status === "accepted" || completed;
  const answered = c.farms.filter((f) => f.status !== "pending").length;
  const pickupPassed = now.getTime() >= new Date(c.pickupStartAt).getTime();
  const steps: ProgressStep[] = [
    { key: "sent", label: "相談送信済み", state: "done" },
    { key: "answer", label: "生産者回答待ち", state: matched ? "done" : "current" },
    { key: "matched", label: "マッチ成立", state: matched ? "done" : "todo" },
    { key: "handover", label: "受け渡し待ち", state: completed ? "done" : matched ? "current" : "todo" },
    { key: "completed", label: "取引完了", state: completed ? "done" : "todo" },
  ];
  if (completed) return { steps, current: "取引完了" };
  const current = !matched
    ? `生産者回答待ち（${answered}/${c.farms.length}農家が回答済み）`
    : pickupPassed ? "受け渡し待ち（受け渡しの予定日時を過ぎています）" : "受け渡し待ち";
  return { steps, current };
}

/** 進行中の相談：条件が変わったもの・全員が対応できなかったものは含めない */
export const isOngoing = (c: Consultation) => c.status === "waiting" || c.status === "accepted" || c.status === "partial";

/** 飲食店のホームの「今やること」（決まった規則で1つだけ） */
export function restaurantTodo(cs: Consultation[]): { text: string; to: "consultations" | "buy" } {
  const ongoing = cs.filter(isOngoing);
  const matched = ongoing.filter((c) => c.status === "accepted");
  if (matched.length > 0) {
    return { text: "マッチ成立：生産者とやり取りできます", to: "consultations" };
  }
  const ready = ongoing.filter((c) => c.farms.some((f) => f.status === "approved"));
  if (ready.length > 0) {
    const farms = farmNames(ready.flatMap((c) => c.farms.filter((f) => f.status === "approved")));
    // まだ返事待ちの農家がいる相談だけなら、成立とは言わずに待つ。一部の農家が対応できない相談があれば従来どおり
    if (ready.every((c) => c.status === "waiting")) return { text: `${farms}が「対応できます」と返事をしました。ほかの農家の返事を待っています`, to: "consultations" };
    return { text: `${farms}が「対応できます」と返事をしました。連絡先を確認して、数量と受け取りを相談しましょう`, to: "consultations" };
  }
  if (ongoing.some((c) => c.status === "waiting")) return { text: "生産者の返事を待っています。返事が来たら、ここと「相談」に表示されます", to: "consultations" };
  return { text: "欲しい食材と量を入力して、仕入れ案をつくりましょう", to: "buy" };
}

/** 生産者の依頼を分ける：未対応（返事が必要）・対応済・今回は難しい・終了（条件が変わった） */
export function classifyRequests(rows: Confirmation[]) {
  const by = (s: ConfirmationStatus) => rows.filter((r) => r.status === s);
  const soonest = (a: Confirmation, b: Confirmation) => a.pickupStartAt.localeCompare(b.pickupStartAt) || a.createdAt.localeCompare(b.createdAt);
  const newest = (a: Confirmation, b: Confirmation) => b.createdAt.localeCompare(a.createdAt);
  return {
    pending: by("pending").sort(soonest), // 受け渡しが近いものから
    accepted: by("approved").sort(newest),
    declined: by("rejected").sort(newest),
    closed: by("stale").sort(newest),
  };
}

/** 生産者の未対応件数（下部ナビの「依頼」の数・ホームの知らせ）。条件が変わった依頼は数えない */
export const pendingCount = (rows: Pick<Confirmation, "status">[]) => rows.filter((r) => r.status === "pending").length;
