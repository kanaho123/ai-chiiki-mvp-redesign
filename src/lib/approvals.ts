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
};
export type Contact = { contactPhone: string | null; contactEmail: string | null };

/** 農家ごとの状態 */
export const confirmationLabel: Record<ConfirmationStatus, string> = {
  pending: "返事待ち", approved: "対応できます", rejected: "今回は対応できません", stale: "条件が変わりました",
};

/** 1つの相談（仕入れ案）全体の状態 */
export type ConsultationStatus = "waiting" | "accepted" | "partial" | "declined" | "stale";
export const consultationLabel: Record<ConsultationStatus, string> = {
  waiting: "返事待ち", accepted: "対応できます", partial: "一部対応できません", declined: "今回は対応できません", stale: "条件が変わりました",
};

/** 規則：条件が変わった農家が1つでもあれば「条件が変わりました」→ 全員が対応できない → 一部が対応できない → 全員対応できる → それ以外は返事待ち */
export function consultationStatus(rows: Pick<Confirmation, "status">[]): ConsultationStatus {
  if (rows.some((r) => r.status === "stale")) return "stale";
  if (rows.length > 0 && rows.every((r) => r.status === "rejected")) return "declined";
  if (rows.some((r) => r.status === "rejected")) return "partial";
  if (rows.length > 0 && rows.every((r) => r.status === "approved")) return "accepted";
  return "waiting";
}

export function overallConfirmation(rows: Confirmation[]): string {
  return rows.length === 0 ? "まだ依頼していません" : consultationLabel[consultationStatus(rows)];
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

/** 進行中の相談：条件が変わったもの・全員が対応できなかったものは含めない */
export const isOngoing = (c: Consultation) => c.status === "waiting" || c.status === "accepted" || c.status === "partial";

/** 飲食店のホームの「今やること」（決まった規則で1つだけ） */
export function restaurantTodo(cs: Consultation[]): { text: string; to: "consultations" | "buy" } {
  const ongoing = cs.filter(isOngoing);
  const ready = ongoing.filter((c) => c.farms.some((f) => f.status === "approved"));
  if (ready.length > 0) {
    const farms = [...new Set(ready.flatMap((c) => c.farms.filter((f) => f.status === "approved").map((f) => f.producerName)))];
    return { text: `${farms.join("・")}が「対応できます」と返事をしました。連絡先を確認して、数量と受け取りを相談しましょう`, to: "consultations" };
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
