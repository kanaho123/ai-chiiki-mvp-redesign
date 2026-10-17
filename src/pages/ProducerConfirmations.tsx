import { useCallback, useEffect, useRef, useState } from "react";
import type { Confirmation, Contact } from "../lib/approvals";
import { confirmationLabel } from "../lib/approvals";
import { confirmationApi } from "../lib/confirmation-api";
import { formatJstDateTime, jstTimeOf } from "../lib/dates";

export function ProducerConfirmations() {
  const [rows, setRows] = useState<Confirmation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++seq.current;
    try {
      const data = await confirmationApi<{ requests: Confirmation[] }>("/api/approvals");
      if (version !== seq.current) return;
      setRows(data.requests); setError(null);
    } catch (e) {
      if (version !== seq.current) return;
      setRows(null); setError(e instanceof Error ? e.message : "確認依頼を読み込めませんでした");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(visibleRefresh, 15_000);
    window.addEventListener("focus", visibleRefresh);
    return () => { ++seq.current; window.clearInterval(timer); window.removeEventListener("focus", visibleRefresh); };
  }, [refresh]);
  async function respond(id: string, status: "approved" | "rejected") {
    if (locked.current) return;
    locked.current = true; ++seq.current; setBusy(id); setError(null); setMessage(null);
    try {
      await confirmationApi(`/api/approvals/${encodeURIComponent(id)}`, "PATCH", { status });
      setMessage(status === "approved" ? "承認しました。この飲食店が連絡先を確認できるようになりました。" : "今回は難しいと回答しました。");
    } catch (e) { setMessage(e instanceof Error ? e.message : "回答できませんでした"); }
    finally { await refresh(); locked.current = false; setBusy(null); }
  }
  return <section className="confirmation-panel" aria-labelledby="producer-requests-title">
    <div className="confirmation-heading"><h2 className="block-title" id="producer-requests-title">確認依頼</h2><button type="button" className="text-btn" disabled={!!busy} onClick={refresh}>更新する</button></div>
    <p className="hint">承認すると、この依頼の飲食店に登録した連絡先を開示します。注文確定・在庫予約にはなりません。</p>
    <ContactSettings />
    {message && <p role="status">{message}</p>}
    {error && <p className="alert bad" role="alert">{error}</p>}
    {!rows && !error && <p>読み込み中…</p>}
    {rows?.length === 0 && <p className="muted">確認依頼はまだありません。</p>}
    {rows && <ul className="confirmation-list">{rows.map(row => <li key={row.id}>
      <div className="confirmation-heading"><strong>{row.restaurantName}</strong><span className={`confirmation-status ${row.status}`}>{confirmationLabel[row.status]}</span></div>
      <p>{row.itemName} {row.quantityKg}kg ／ ¥{row.priceYenPerKg.toLocaleString("ja-JP")}/kg<br />商品代 ¥{row.subtotalYen.toLocaleString("ja-JP")}（税込・受渡費別）</p>
      <p>{formatJstDateTime(row.pickupStartAt)}〜{jstTimeOf(row.pickupEndAt)}<br />{row.pickupPlace}</p>
      {row.status === "pending" && <div className="confirmation-actions">
        <button type="button" className="btn-primary" disabled={!!busy} onClick={() => respond(row.id, "approved")} aria-busy={busy === row.id}>承認して連絡先を開示</button>
        <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => respond(row.id, "rejected")}>今回は難しい（NG）</button>
      </div>}
      {row.status === "stale" && <p className="hint">在庫・条件が変わったため回答できません。飲食店からの新しい依頼をお待ちください。</p>}
    </li>)}</ul>}
  </section>;
}

function ContactSettings() {
  const [contact, setContact] = useState({ contactPhone: "", contactEmail: "" });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    confirmationApi<{ contact: Contact }>("/api/approvals?view=contact", "GET", undefined, controller.signal)
      .then(data => { setContact({ contactPhone: data.contact.contactPhone ?? "", contactEmail: data.contact.contactEmail ?? "" }); setLoaded(true); })
      .catch(() => { if (!controller.signal.aborted) setMessage("連絡先を読み込めませんでした。画面を再読み込みしてください。"); });
    return () => controller.abort();
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage(null);
    try { await confirmationApi("/api/approvals", "PATCH", contact); setMessage("連絡先を保存しました。"); }
    catch (e) { setMessage(e instanceof Error ? e.message : "保存できませんでした"); }
    finally { setBusy(false); }
  }
  return <details className="more-info contact-settings"><summary>承認後に開示する連絡先を登録・変更</summary>
    <form className="contact-form" onSubmit={save}>
      <p className="hint">電話番号かメールアドレスのどちらか1つが必要です。承認前には飲食店へ表示しません。</p>
      <label className="field"><span className="label">電話番号</span><input type="tel" autoComplete="tel" maxLength={24} value={contact.contactPhone} disabled={!loaded || busy} onChange={e => setContact({ ...contact, contactPhone: e.target.value })} /></label>
      <label className="field"><span className="label">メールアドレス</span><input type="email" autoComplete="email" maxLength={254} value={contact.contactEmail} disabled={!loaded || busy} onChange={e => setContact({ ...contact, contactEmail: e.target.value })} /></label>
      <button className="btn-secondary" disabled={!loaded || busy}>連絡先を保存</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
