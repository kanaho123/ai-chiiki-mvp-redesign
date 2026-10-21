import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Confirmation } from "../../lib/approvals";
import { STALE_RECHECK, confirmationLabel, farmNames, isMatched, overallConfirmation } from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { PATHS } from "../../routes/paths";
import { ProgressSteps } from "./ProgressSteps";
import type { Freshness, Shown } from "./types";

// 仕入れ案の画面の「生産者に仕入れ相談する」：相談の送信と、農家ごとの返事の状態まで（仕入れ先を決める場所）。
// 取引を進める機能（トーク・連絡先・受け取り完了）は相談の詳細だけで扱う。マッチ成立後は短い表示と、相談の詳細への導線だけ。

/** onMatchedChange：マッチ成立（全農家が「対応できます」・条件が最新）かどうかを仕入れ案の画面へ知らせる（上部の短い表示に使う） */
export function ApprovalPanel({ shown, freshness, onMatchedChange }: { shown: Shown; freshness: Freshness; onMatchedChange?: (matched: boolean) => void }) {
  const [rows, setRows] = useState<Confirmation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const actionLock = useRef(false);
  const fingerprint = shown.fingerprint;
  const current = freshness === "fresh" && !!fingerprint;
  const refresh = useCallback(async () => {
    if (!fingerprint || freshness !== "fresh") return;
    const seq = ++sequence.current;
    try {
      const data = await confirmationApi<{ requests: Confirmation[] }>(`/api/approvals?fingerprint=${encodeURIComponent(fingerprint)}`);
      if (seq !== sequence.current) return;
      setRows(data.requests); setError(null);
    } catch (e) {
      if (seq !== sequence.current) return;
      setRows(null); setError(friendlyError(e, "確認状態を読み込めませんでした。もう一度お試しください"));
    }
  }, [fingerprint, freshness]);
  useEffect(() => {
    if (!current) { ++sequence.current; return; }
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(visibleRefresh, 15_000);
    window.addEventListener("focus", visibleRefresh);
    return () => { ++sequence.current; window.clearInterval(timer); window.removeEventListener("focus", visibleRefresh); };
  }, [current, refresh]);

  async function send() {
    if (actionLock.current || !current) return;
    actionLock.current = true; ++sequence.current; setBusy(true); setError(null);
    try {
      const data = await confirmationApi<{ requests: Confirmation[] }>("/api/approvals", "POST", { request: shown.request, version: shown.version, fingerprint });
      setRows(data.requests);
    } catch (e) { setRows(null); setError(friendlyError(e, "依頼を送れませんでした。もう一度お試しください")); }
    finally { actionLock.current = false; setBusy(false); }
  }

  const names = farmNames(shown.plan.allocations);
  const matched = current && !!rows && isMatched(rows);
  const sent = !!rows && rows.length > 0;
  useEffect(() => { onMatchedChange?.(matched); }, [matched, onMatchedChange]);
  useEffect(() => () => onMatchedChange?.(false), [onMatchedChange]);
  return <section className="confirmation-panel" aria-labelledby="confirm-producers-title">
    <h3 className="block-title" id="confirm-producers-title">生産者に仕入れ相談する</h3>
    {!sent && <p className="hint">この仕入れ案の農家（{names}）に、この条件で相談できるか確認します。「対応できます」の返事は注文確定ではなく、在庫も確保されません。</p>}
    {!current ? <p role="status">{freshness === "stale" ? STALE_RECHECK : "最新の仕入れ案を計算してから確認してください。以前の返事は使いません。"}</p> : <>
      {sent && <ProgressSteps farms={rows} />}
      {matched ? (
        <section className="match-banner match-compact" aria-labelledby="match-title">
          <p className="match-title" id="match-title" role="status">マッチ成立</p>
          <p className="match-text">生産者とのやり取りができます</p>
          <Link className="btn-primary btn-block link-btn match-go" to={`${PATHS.restaurant.consultations}/${encodeURIComponent(fingerprint!)}`}>相談状況・やり取りを見る</Link>
        </section>
      ) : <p className="confirmation-overall" role="status">{rows ? overallConfirmation(rows) : error ? "確認状態を取得できません" : "確認状態を読み込み中…"}</p>}
      {!matched && sent && <ul className="confirmation-list">{rows.map(row => <li key={row.id}>
        <div className="confirmation-heading"><strong>{row.producerName} {row.quantityKg}kg</strong><span className={`confirmation-status ${row.status}`}>{confirmationLabel[row.status]}</span></div>
      </li>)}</ul>}
      {rows?.length === 0 && <button type="button" className="btn-primary btn-block" disabled={busy} onClick={send} aria-busy={busy}>{busy ? "送信中…" : `${names}に仕入れ相談する（${shown.plan.allocations.length}件）`}</button>}
      {error && <p className="alert bad" role="alert">{error}</p>}
      {!matched && <button type="button" className="text-btn" disabled={busy} onClick={refresh}>確認状態を更新する</button>}
      {error && <button type="button" className="btn-secondary" disabled={busy} onClick={send}>同じ案で再送する（重複しません）</button>}
    </>}
  </section>;
}
