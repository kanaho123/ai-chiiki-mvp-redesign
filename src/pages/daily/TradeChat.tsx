import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { TradeMessage } from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { formatJstDateTime } from "../../lib/dates";

// 取引のやり取り（相談1件＝飲食店と1つの農家）。テキスト・送信者・日時・履歴だけ。
// 新しいメッセージは、画面を開いている間の15秒ごとの読み直しと「更新」ボタンで取りにいく（リアルタイム通信・既読・画像・削除はなし）。
// 取引が完了したら、読むだけ（送れない）。

export const MESSAGE_MAX = 1000;
export const POLL_MS = 15_000;

export function TradeChat({ requestId, partnerName, completed = false, showTitle = true }: { requestId: string; partnerName: string; completed?: boolean; showTitle?: boolean }) {
  const [messages, setMessages] = useState<TradeMessage[] | null>(null);
  const [closed, setClosed] = useState(completed);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/approvals/${encodeURIComponent(requestId)}/messages`;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await confirmationApi<{ messages: TradeMessage[]; completed: boolean }>(url);
      if (mine !== seq.current) return;
      setMessages(d.messages);
      setClosed(d.completed);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(friendlyError(e, "やり取りを読み込めませんでした。「更新」を押してください"));
    }
  }, [url]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => { if (completed) setClosed(true); }, [completed]);

  const body = text.trim();
  const tooLong = [...body].length > MESSAGE_MAX;
  async function send() {
    if (!body || tooLong || sending) return;
    setSending(true);
    setError(null);
    try {
      const d = await confirmationApi<{ message: TradeMessage }>(url, "POST", { body });
      setMessages((prev) => [...(prev ?? []), d.message]);
      setText("");
    } catch (e) {
      setError(friendlyError(e, "送れませんでした。もう一度お試しください"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="trade-chat" aria-label={`${partnerName}とのやり取り`}>
      <div className="trade-chat-head">
        {showTitle ? <b>{partnerName}とのやり取り</b> : <span />}
        <button type="button" className="text-btn" onClick={() => void load()}><Icon name="refresh" size={18} />更新</button>
      </div>
      {messages === null && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {messages?.length === 0 && <p className="empty-note">まだメッセージはありません。受け渡しの確認などを送ってみましょう。</p>}
      {messages && messages.length > 0 && (
        <ol className="trade-messages">
          {messages.map((m) => (
            <li key={m.id} className={`trade-message ${m.mine ? "mine" : "theirs"}`}>
              <span className="trade-meta"><b>{m.mine ? "あなた" : m.senderName}</b><time dateTime={m.createdAt}>{formatJstDateTime(m.createdAt)}</time></span>
              <p className="trade-body">{m.body}</p>
            </li>
          ))}
        </ol>
      )}
      {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
      {closed ? (
        <p className="hint">この取引は完了しています。やり取りは読むだけです。</p>
      ) : (
        <form className="trade-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label>
            <span className="sr-only">{partnerName}へのメッセージ</span>
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="例：当日はよろしくお願いします" />
          </label>
          {tooLong && <p className="hint bad-text" role="status">メッセージは{MESSAGE_MAX}文字以内で入力してください</p>}
          <button type="submit" className="btn-primary" disabled={!body || tooLong || sending} aria-busy={sending}>{sending ? "送信中…" : "送信"}</button>
        </form>
      )}
    </section>
  );
}
