import { useCallback, useEffect, useRef, useState } from "react";
import type { Confirmation } from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { formatJstDateTime, jstTimeOf } from "../../lib/dates";

// 日常の画面（ホーム・相談・依頼）で使うデータの読み込み。表示する状態はサーバーの実データだけを使う。

export type Load<T> = { data: T | null; error: string | null; reload: () => Promise<void> };

/** 本人の相談・依頼の一覧（/api/approvals）。画面に戻ってきたときにも読み直す */
export function useConfirmations(): Load<Confirmation[]> {
  const [data, setData] = useState<Confirmation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await confirmationApi<{ requests: Confirmation[] }>("/api/approvals");
      if (mine !== seq.current) return;
      setData(d.requests);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(friendlyError(e, "読み込めませんでした。もう一度お試しください"));
    }
  }, []);
  useEffect(() => {
    void reload();
    const onFocus = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", onFocus);
    return () => { ++seq.current; window.removeEventListener("focus", onFocus); };
  }, [reload]);
  return { data, error, reload };
}

export type SupplyRow = {
  id: string; item: { name: string }; variety: { name: string }; availableKg: number; priceYenPerKg: number; published: boolean;
  grade?: "regular" | "irregular"; updatedAt: string;
  slot: { label: string; placeName: string; startAt: string; endAt: string };
};
export type SlotRow = { id: string; label: string; placeName: string; startAt: string; endAt: string };
/** places：いつもの受け渡し場所（一般向けの環境だけ。デモ用の環境は null） */
export type SuppliesData = { supplies: SupplyRow[]; slots: SlotRow[]; places?: { placeId: string; name: string }[] | null };

/** 生産者本人の出品と、参加している受渡の回（/api/supplies） */
export function useSupplies(): Load<SuppliesData> {
  const [data, setData] = useState<SuppliesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await confirmationApi<SuppliesData>("/api/supplies"));
      setError(null);
    } catch (e) {
      setError(friendlyError(e, "出品を読み込めませんでした。もう一度お試しください"));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

export const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
/** 例：10月23日(木) 10:00〜11:00 */
export const whenText = (startAt: string, endAt: string) => `${formatJstDateTime(startAt)}〜${jstTimeOf(endAt)}`;
