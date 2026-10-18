import { useCallback, useEffect, useRef, useState } from "react";
import type { Confirmation, Contact } from "../../lib/approvals";
import { STALE_RECHECK, confirmationLabel, farmNames, isMatched, overallConfirmation } from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { MatchBanner } from "./MatchBanner";
import type { Freshness, Shown } from "./types";

export function ApprovalPanel({ shown, freshness }: { shown: Shown; freshness: Freshness }) {
  const [rows, setRows] = useState<Confirmation[] | null>(null);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
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
      setContacts(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => data.requests.some(r => r.id === id && r.status === "approved"))));
    } catch (e) {
      if (seq !== sequence.current) return;
      setRows(null); setContacts({}); setError(friendlyError(e, "確認状態を読み込めませんでした。もう一度お試しください"));
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
    actionLock.current = true; ++sequence.current; setBusy(true); setError(null); setContacts({});
    try {
      const data = await confirmationApi<{ requests: Confirmation[] }>("/api/approvals", "POST", { request: shown.request, version: shown.version, fingerprint });
      setRows(data.requests);
    } catch (e) { setRows(null); setError(friendlyError(e, "依頼を送れませんでした。もう一度お試しください")); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function showContact(id: string) {
    if (actionLock.current || !current) return;
    actionLock.current = true; setBusy(true); setContactError(null);
    try {
      const data = await confirmationApi<{ contact: Contact }>(`/api/approvals/${encodeURIComponent(id)}`);
      setContacts(previous => ({ ...previous, [id]: data.contact }));
    } catch (e) {
      setContacts({}); setContactError(friendlyError(e, "連絡先を読み込めませんでした。もう一度お試しください"));
      await refresh();
    } finally { actionLock.current = false; setBusy(false); }
  }

  const names = farmNames(shown.plan.allocations);
  const matched = !!rows && isMatched(rows);
  return <section className="confirmation-panel" aria-labelledby="confirm-producers-title">
    <h3 className="block-title" id="confirm-producers-title">生産者に仕入れ相談する</h3>
    <p className="hint">この仕入れ案の農家（{names}）に、この条件で相談できるか確認します。「対応できます」の返事は注文確定ではなく、在庫も確保されません。</p>
    {!current ? <p role="status">{freshness === "stale" ? STALE_RECHECK : "最新の仕入れ案を計算してから確認してください。以前の返事は使いません。"}</p> : <>
      {matched
        ? <MatchBanner farms={rows!} onContactError={refresh} />
        : <p className="confirmation-overall" role="status">{rows ? overallConfirmation(rows) : error ? "確認状態を取得できません" : "確認状態を読み込み中…"}</p>}
      {rows && rows.length > 0 && <ul className="confirmation-list">{rows.map(row => <li key={row.id}>
        <div className="confirmation-heading"><strong>{row.producerName} {row.quantityKg}kg</strong><span className={`confirmation-status ${row.status}`}>{confirmationLabel[row.status]}</span></div>
        {row.status === "approved" && <>
          <button type="button" className="btn-secondary" onClick={() => showContact(row.id)} disabled={busy}>連絡先を見る</button>
          {contacts[row.id] && <div className="contact-details">
            {contacts[row.id].contactPhone && <a href={`tel:${contacts[row.id].contactPhone!.replace(/[^+\d]/g, "")}`}>電話：{contacts[row.id].contactPhone}</a>}
            {contacts[row.id].contactEmail && <a href={`mailto:${encodeURIComponent(contacts[row.id].contactEmail!)}`}>メール：{contacts[row.id].contactEmail}</a>}
            {!contacts[row.id].contactPhone && !contacts[row.id].contactEmail && <p>連絡先が未登録です。</p>}
            <p className="hint">受け渡しの詳細や最終確認は、農家と直接相談して決めてください。example.invalid はデモ用の架空の宛先です。</p>
          </div>}
        </>}
      </li>)}</ul>}
      {rows?.length === 0 && <button type="button" className="btn-primary btn-block" disabled={busy} onClick={send} aria-busy={busy}>{busy ? "送信中…" : `${names}に仕入れ相談する（${shown.plan.allocations.length}件）`}</button>}
      {error && <p className="alert bad" role="alert">{error}</p>}
      {contactError && <p className="alert bad" role="alert">{contactError}</p>}
      <button type="button" className="text-btn" disabled={busy} onClick={refresh}>確認状態を更新する</button>
      {error && <button type="button" className="btn-secondary" disabled={busy} onClick={send}>同じ案で再送する（重複しません）</button>}
    </>}
  </section>;
}
