import { useState } from "react";
import { NOT_AN_ORDER, matchMessage, type Confirmation, type Contact } from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { useSession } from "../../routes/session";
import { whenText, yen } from "../daily/data";

// マッチ成立（仕入れ案の全農家が「対応できます」で、条件が変わっていない）ときだけ表示する。
// 「取引相談へ進む」は既存の連絡先 API（農家ごと・「対応できます」の後だけ）を使い、登録されている連絡手段だけを出す。
// チャットはつくらない。メールは利用者のメールアプリで開くだけ（アプリからは送らない）。

/** 取引相談のメール（件名・本文入り）。数量・価格・受け渡しは仕入れ案ですでにそろっているので、本文では受け渡しの詳細と最終確認を相談する */
export function dealMailHref(row: Confirmation, email: string) {
  const when = `${whenText(row.pickupStartAt, row.pickupEndAt)}・${row.pickupPlace}`;
  const subject = `【仕入れ相談】${row.itemName} ${row.quantityKg}kg（${when}）`;
  const body = [
    `${row.producerName} 御中`,
    "",
    `AI地域商社で仕入れ相談をお送りした${row.restaurantName}です。`,
    "「対応できます」とご回答いただきありがとうございます。",
    "",
    `品目：${row.itemName} ${row.quantityKg}kg（${yen(row.priceYenPerKg)}/kg・商品代 ${yen(row.subtotalYen)}）`,
    `受け渡し：${when}`,
    "",
    "受け渡しの詳細や最終確認について、ご相談させてください。",
  ].join("\r\n");
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, "")}`;

export function MatchBanner({ farms, onContactError }: { farms: Confirmation[]; onContactError?: () => void }) {
  const { appMode } = useSession();
  const [contacts, setContacts] = useState<Record<string, Contact> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDeal() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const entries = await Promise.all(farms.map(async (f) =>
        [f.id, (await confirmationApi<{ contact: Contact }>(`/api/approvals/${encodeURIComponent(f.id)}`)).contact] as const));
      setContacts(Object.fromEntries(entries));
    } catch (e) {
      setContacts(null);
      setError(friendlyError(e, "連絡先を読み込めませんでした。もう一度お試しください"));
      onContactError?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="match-banner" aria-labelledby="match-title">
      <p className="match-title" id="match-title" role="status">🎉 マッチ成立</p>
      <p className="match-text">{matchMessage(farms)}</p>
      <p className="match-note">{NOT_AN_ORDER}</p>
      {!contacts && (
        <button type="button" className="btn-primary btn-block" onClick={openDeal} disabled={busy} aria-busy={busy}>
          {busy ? "読み込み中…" : "取引相談へ進む"}
        </button>
      )}
      {error && <p className="alert bad" role="alert">{error}</p>}
      {contacts && (
        <>
          <ul className="deal-contacts">
            {farms.map((f) => {
              const c = contacts[f.id];
              return (
                <li key={f.id} className="deal-farm">
                  <b className="deal-farm-name">{f.producerName}</b>
                  {c?.contactEmail && <a className="btn-primary btn-block link-btn deal-mail" href={dealMailHref(f, c.contactEmail)}>{f.producerName}にメールで相談する</a>}
                  {c?.contactPhone && <a className="btn-secondary btn-block link-btn deal-tel" href={telHref(c.contactPhone)}>電話で相談する（{c.contactPhone}）</a>}
                  {c?.contactEmail && <span className="deal-address">メール：{c.contactEmail}</span>}
                  {!c?.contactEmail && !c?.contactPhone && <p>連絡先が未登録です。</p>}
                </li>
              );
            })}
          </ul>
          <p className="hint">受け渡しの詳細や最終確認は、農家と直接相談して決めてください。{appMode === "demo" && "example.invalid はデモ用の架空の宛先です。"}</p>
        </>
      )}
    </section>
  );
}
