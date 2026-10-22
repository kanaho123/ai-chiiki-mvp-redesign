import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { REVIEW_COMMENT_MAX, TRADE_RATINGS, type MyReview, type TradeRating, type TradeReviewState } from "../../lib/approvals";
import { ApiError, confirmationApi, friendlyError } from "../../lib/confirmation-api";

// 取引完了後の1取引（飲食店 × 農家）の評価。「今回の取引はいかがでしたか？」→ 良かった／残念だった → 一言（任意）→ 評価済み。
// 飲食店には、評価とは別に「☆ いつもの農家に登録」（評価の内容で自動登録はしない）。評価は相手やほかの利用者には見せない。
const labelOf = (v: TradeRating) => TRADE_RATINGS.find((r) => r.value === v)?.label ?? "";

export function TradeReviewBox({ requestId, partnerName, role }: { requestId: string; partnerName: string; role: "restaurant" | "producer" }) {
  const base = `/api/approvals/${encodeURIComponent(requestId)}`;
  const [state, setState] = useState<TradeReviewState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rating, setRating] = useState<TradeRating | "">("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usualBusy, setUsualBusy] = useState(false);
  const [usualError, setUsualError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setState(await confirmationApi<TradeReviewState>(`${base}/review`));
    } catch (e) {
      setLoadError(friendlyError(e, "評価の状態を読み込めませんでした。もう一度お試しください"));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  const text = comment.trim();
  const tooLong = [...text].length > REVIEW_COMMENT_MAX;
  async function send() {
    if (!rating || tooLong || saving) return;
    setSaving(true);
    setError(null);
    try {
      const d = await confirmationApi<{ review: MyReview }>(`${base}/review`, "POST", { rating, comment: text });
      setState((s) => s && { ...s, review: d.review });
    } catch (e) {
      setError(friendlyError(e, "評価を送れませんでした。もう一度お試しください"));
      if (e instanceof ApiError && e.status === 409) await load(); // すでに評価済みなど：今の状態を出し直す
    } finally {
      setSaving(false);
    }
  }

  async function markUsual() {
    if (usualBusy) return;
    setUsualBusy(true);
    setUsualError(null);
    try {
      await confirmationApi<{ usual: true }>(`${base}/usual`, "POST", {});
      setState((s) => s && { ...s, usual: true });
    } catch (e) {
      setUsualError(friendlyError(e, "登録できませんでした。もう一度お試しください"));
    } finally {
      setUsualBusy(false);
    }
  }

  return (
    <section className="review-box" aria-label={`${partnerName}との取引の評価`}>
      {role === "restaurant" && (
        <div className="review-head"><b>{partnerName}</b>{state?.usual && <span className="usual-tag">☆ いつもの農家</span>}</div>
      )}
      {loadError && (
        <div className="alert bad" role="alert"><Icon name="alert" />{loadError}
          <button type="button" className="text-btn" onClick={() => void load()}>再読み込み</button>
        </div>
      )}
      {!state && !loadError && <p className="muted" aria-busy="true">読み込み中…</p>}
      {state && (state.review ? (
        <p className="review-done" role="status">
          <Icon name="check" />評価済み：{labelOf(state.review.rating)}{state.review.comment && <span className="review-comment">「{state.review.comment}」</span>}
        </p>
      ) : (
        <form className="review-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <fieldset className="field">
            <legend className="label">今回の取引はいかがでしたか？</legend>
            <div className="choice-list cols-2">
              {TRADE_RATINGS.map((o) => (
                <label key={o.value} className="option-card choice">
                  <input type="radio" name={`rating-${requestId}`} value={o.value} checked={rating === o.value} onChange={() => setRating(o.value)} />
                  <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
                  <span><b>{o.label}</b></span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="label">一言コメント（任意）</span>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="例：丁寧に対応していただきました" />
          </label>
          {tooLong && <p className="hint bad-text" role="status">一言コメントは{REVIEW_COMMENT_MAX}文字以内で入力してください</p>}
          <p className="hint">評価は相手やほかの利用者には表示されません。送ったあとは変更できません。</p>
          <button type="submit" className="btn-primary" disabled={!rating || tooLong || saving} aria-busy={saving}>{saving ? "送信中…" : "評価を送る"}</button>
        </form>
      ))}
      {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
      {role === "restaurant" && state && !state.usual && (
        <button type="button" className="btn-secondary btn-block" disabled={usualBusy} aria-busy={usualBusy} onClick={() => void markUsual()}
          aria-label={`${partnerName}をいつもの農家に登録`}>☆ いつもの農家に登録</button>
      )}
      {usualError && <div className="alert bad" role="alert"><Icon name="alert" />{usualError}</div>}
    </section>
  );
}
