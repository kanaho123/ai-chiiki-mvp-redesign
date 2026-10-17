export type ConfirmationStatus = "pending" | "approved" | "rejected" | "stale";
export type Confirmation = {
  id: string; supplyId: string; producerName: string; restaurantName: string;
  planFingerprint: string; itemName: string; quantityKg: number; priceYenPerKg: number; subtotalYen: number;
  pickupStartAt: string; pickupEndAt: string; pickupPlace: string;
  status: ConfirmationStatus; createdAt: string;
};
export type Contact = { contactPhone: string | null; contactEmail: string | null };
export const confirmationLabel: Record<ConfirmationStatus, string> = {
  pending: "承認待ち", approved: "✓ 承認済", rejected: "NG・今回は難しい", stale: "条件変更・再確認が必要",
};
export function overallConfirmation(rows: Confirmation[]): string {
  if (rows.length === 0) return "まだ依頼していません";
  if (rows.some((r) => r.status === "stale")) return "再計算・再確認が必要";
  if (rows.some((r) => r.status === "rejected")) return "一部NG";
  return rows.every((r) => r.status === "approved") ? "全員承認済" : "確認中";
}
