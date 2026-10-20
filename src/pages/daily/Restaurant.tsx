import { useState } from "react";
import { Link, useParams } from "react-router";
import { nameOf } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import {
  RECEIVE_CONFIRM, STALE_RECHECK, TRADE_DECLINED, confirmationLabel, consultationLabel, groupConsultations, isMatched, isOngoing, restaurantTodo,
  type Consultation, type Contact,
} from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { MatchBanner } from "../restaurant/MatchBanner";
import { ProgressSteps } from "../restaurant/ProgressSteps";
import { PATHS } from "../../routes/paths";
import { useMe } from "../../routes/session";
import { ErrorRetry } from "./ErrorRetry";
import { TradeChat } from "./TradeChat";
import { WelcomeNotice } from "./WelcomeNotice";
import { useConfirmations, whenText, yen } from "./data";

// 飲食店のホーム・相談一覧・相談の詳細。
// 相談＝同じ仕入れ案で生産者に確認を依頼したもの。状態は「返事待ち／マッチ成立／一部対応できません／今回は対応できません」で表す。
// マッチ成立は全農家が「対応できます」のときだけ。それまでは農家ごとの状態で見せる。
// 相談の詳細は取引ページを兼ねる：マッチ成立（取引の成立）後は農家ごとのやり取りと「受け取り完了」（仕入れ案ごとに1回）、完了後は「取引が完了しました」。

const consultationPath = (id: string) => `${PATHS.restaurant.consultations}/${id}`;

function StatusTag({ status }: { status: Consultation["status"] }) {
  return <span className={`state-tag state-${status}`}>{consultationLabel[status]}</span>;
}

/** 相談1件の短い表示（「トマト 10kg」＋農家ごとの状態） */
function ConsultationCard({ c }: { c: Consultation }) {
  return (
    <li>
      <Link className="consult-card" to={consultationPath(c.id)}>
        <span className="consult-head">
          <b className="consult-title">{c.itemName} {c.totalKg}kg</b>
          <StatusTag status={c.status} />
        </span>
        <span className="consult-when">{whenText(c.pickupStartAt, c.pickupEndAt)}・{c.pickupPlace}</span>
        <ProgressSteps farms={c.farms} compact />
        <span className="consult-farms">
          {c.farms.map((f) => <span key={f.id} className={`farm-line farm-${f.status}`}>{f.producerName}：{confirmationLabel[f.status]}</span>)}
        </span>
        <span className="consult-more">詳しく見る<Icon name="chevronRight" size={18} /></span>
      </Link>
    </li>
  );
}

export function RestaurantHome() {
  const me = useMe();
  const { data, error, reload } = useConfirmations();
  const consultations = data ? groupConsultations(data) : null;
  const ongoing = consultations?.filter(isOngoing) ?? [];
  const todo = consultations ? restaurantTodo(consultations) : null;
  return (
    <main className="screen home">
      <div className="title-block">
        <span className="eyebrow">ホーム</span>
        <h1 className="display">{nameOf(me)}</h1>
      </div>
      <WelcomeNotice role="restaurant" text="さっそく、欲しい食材の仕入れ案をつくってみましょう。" />
      {error && <ErrorRetry text={error} onRetry={reload} />}

      <section className="todo" aria-labelledby="todo-title">
        <h2 className="section-title" id="todo-title">今やること</h2>
        {todo ? (
          <p className="todo-text">{todo.text}</p>
        ) : !error && <p className="muted" aria-busy="true">読み込み中…</p>}
        {todo?.to === "consultations" && <Link className="text-btn link-btn todo-link" to={PATHS.restaurant.consultations}>相談を見る<Icon name="chevronRight" /></Link>}
      </section>

      <section aria-labelledby="ongoing-title">
        <h2 className="section-title" id="ongoing-title">進行中の相談</h2>
        {consultations && ongoing.length === 0 && <p className="empty-note">進行中の相談はありません</p>}
        {ongoing.length > 0 && <ul className="consult-list">{ongoing.slice(0, 3).map((c) => <ConsultationCard key={c.id} c={c} />)}</ul>}
        {ongoing.length > 3 && <Link className="text-btn link-btn" to={PATHS.restaurant.consultations}>ほかの相談も見る（全{ongoing.length}件）<Icon name="chevronRight" /></Link>}
      </section>

      <Link className="btn-primary btn-block link-btn" to={PATHS.restaurant.buy}><Icon name="basket" />新しい仕入れ案をつくる</Link>
    </main>
  );
}

export function RestaurantConsultations() {
  const { data, error, reload } = useConfirmations();
  const consultations = data ? groupConsultations(data) : null;
  const ongoing = consultations?.filter(isOngoing) ?? [];
  const ended = consultations?.filter((c) => !isOngoing(c)) ?? [];
  return (
    <main className="screen">
      <div className="title-block">
        <h1 className="display">相談</h1>
        <p className="muted">生産者に確認を依頼した仕入れです。「対応できます」と返事をした農家の連絡先を見られます。</p>
      </div>
      {error && <ErrorRetry text={error} onRetry={reload} />}
      {!consultations && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {consultations?.length === 0 && (
        <>
          <p className="empty-note">まだ相談はありません。仕入れ案をつくって「生産者に確認する」を押すと、ここに表示されます。</p>
          <Link className="btn-primary btn-block link-btn" to={PATHS.restaurant.buy}><Icon name="basket" />新しい仕入れ案をつくる</Link>
        </>
      )}
      {ongoing.length > 0 && (
        <section aria-labelledby="c-ongoing">
          <h2 className="section-title" id="c-ongoing">進行中（{ongoing.length}件）</h2>
          <ul className="consult-list">{ongoing.map((c) => <ConsultationCard key={c.id} c={c} />)}</ul>
        </section>
      )}
      {ended.length > 0 && (
        <section aria-labelledby="c-ended">
          <h2 className="section-title" id="c-ended">終わった相談（{ended.length}件）</h2>
          <p className="hint">取引が完了した相談、全員が対応できなかった相談、在庫・条件が変わった相談です。必要なら仕入れ案をつくり直してください。</p>
          <ul className="consult-list">{ended.map((c) => <ConsultationCard key={c.id} c={c} />)}</ul>
        </section>
      )}
    </main>
  );
}

export function RestaurantConsultationDetail() {
  const id = useParams().id ?? "";
  const { data, error, reload } = useConfirmations();
  const c = data ? groupConsultations(data).find((x) => x.id === id) ?? null : undefined;
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  /** 受け取り完了：仕入れ案ごとに1回（同じ仕入れ案の全農家をまとめて完了にする）。もう一度押しても同じ結果 */
  async function markReceived() {
    if (!c || receiving) return;
    setReceiving(true);
    setReceiveError(null);
    try {
      await confirmationApi("/api/approvals/received", "POST", { fingerprint: c.id });
      setConfirming(false);
    } catch (e) {
      setReceiveError(friendlyError(e, "受け取り完了にできませんでした。もう一度お試しください"));
    } finally {
      await reload();
      setReceiving(false);
    }
  }

  async function showContact(requestId: string) {
    setBusy(requestId);
    setContactError(null);
    try {
      const d = await confirmationApi<{ contact: Contact }>(`/api/approvals/${encodeURIComponent(requestId)}`);
      setContacts((prev) => ({ ...prev, [requestId]: d.contact }));
    } catch (e) {
      setContactError(friendlyError(e, "連絡先を読み込めませんでした。もう一度お試しください"));
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="screen">
      <Link className="text-btn link-btn back-link" to={PATHS.restaurant.consultations}><Icon name="chevronRight" style={{ transform: "rotate(180deg)" }} />相談の一覧へ</Link>
      {error && <ErrorRetry text={error} onRetry={reload} />}
      {c === undefined && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {c === null && <p className="empty-note">この相談は見つかりませんでした。</p>}
      {c && (
        <>
          <div className="title-block">
            <span className="eyebrow">相談</span>
            <h1 className="display">{c.itemName} {c.totalKg}kg</h1>
            <p className="consult-when">{whenText(c.pickupStartAt, c.pickupEndAt)}・{c.pickupPlace}</p>
            <p><StatusTag status={c.status} /></p>
          </div>
          <ProgressSteps farms={c.farms} />
          {c.status === "completed" && (
            <section className="trade-done" aria-labelledby="trade-done-title">
              <p className="trade-done-title" id="trade-done-title" role="status"><Icon name="check" size={28} strokeWidth={3} />取引が完了しました</p>
              <dl className="trade-done-facts">
                <div><dt>品目</dt><dd>{c.itemName}</dd></div>
                <div><dt>合計数量</dt><dd>{c.totalKg}kg</dd></div>
                <div><dt>生産者</dt><dd>{[...new Set(c.farms.map((f) => f.producerName))].join("・")}</dd></div>
                <div><dt>受け取り場所</dt><dd>{c.pickupPlace}</dd></div>
                <div><dt>受け取り日時</dt><dd>{whenText(c.pickupStartAt, c.pickupEndAt)}</dd></div>
              </dl>
            </section>
          )}
          {isMatched(c.farms)
            ? <MatchBanner farms={c.farms} onContactError={reload} />
            : c.status !== "completed" && <p className="hint">「対応できます」は注文の確定ではありません。受け渡しの詳細や最終確認は、農家と直接相談して決めてください。</p>}
          {c.status === "stale" && <div className="alert warn" role="status"><Icon name="alert" />{STALE_RECHECK}</div>}
          {(c.status === "partial" || c.status === "declined") && <div className="alert warn" role="status"><Icon name="alert" />{TRADE_DECLINED}</div>}
          <ul className="farm-list">
            {c.farms.map((f) => (
              <li key={f.id} className={`farm-row farm-${f.status}`}>
                <div className="farm-head"><b>{f.producerName}</b><span className={`state-tag state-farm-${f.status}`}>{confirmationLabel[f.status]}</span></div>
                <p className="farm-detail">{f.quantityKg}kg・{yen(f.priceYenPerKg)}/kg・小計 {yen(f.subtotalYen)}（税込・受け渡し費用は別）</p>
                {f.status === "approved" && !contacts[f.id] && (
                  <button type="button" className="btn-secondary" disabled={busy !== null} aria-busy={busy === f.id} onClick={() => showContact(f.id)}>
                    <Icon name="info" />連絡先を見る
                  </button>
                )}
                {contacts[f.id] && (
                  <div className="contact-details">
                    {contacts[f.id].contactPhone && <a href={`tel:${contacts[f.id].contactPhone!.replace(/[^+\d]/g, "")}`}>電話：{contacts[f.id].contactPhone}</a>}
                    {contacts[f.id].contactEmail && <a href={`mailto:${encodeURIComponent(contacts[f.id].contactEmail!)}`}>メール：{contacts[f.id].contactEmail}</a>}
                  </div>
                )}
                {/* 取引の成立後：この農家とのやり取り（1農家なら最初から開く） */}
                {(isMatched(c.farms) || c.status === "completed") && (
                  <details className="trade-chat-wrap" open={c.farms.length === 1}>
                    <summary>{f.producerName}とのやり取り<Icon name="chevronDown" /></summary>
                    <TradeChat requestId={f.id} partnerName={f.producerName} completed={c.status === "completed"} showTitle={false} />
                  </details>
                )}
              </li>
            ))}
          </ul>
          {contactError && <div className="alert bad" role="alert"><Icon name="alert" />{contactError}</div>}
          <p className="hint">商品代の合計 {yen(c.subtotalYen)}（税込・受け渡し費用は別）</p>
          {isMatched(c.farms) && (
            <section className="receive-box" aria-labelledby="receive-title">
              <h2 className="section-title" id="receive-title">受け取り</h2>
              <p className="hint">商品を受け取ったら、この仕入れ案の取引をまとめて完了にします（農家ごとに押す必要はありません）。</p>
              {!confirming ? (
                <button type="button" className="btn-primary btn-block" onClick={() => { setReceiveError(null); setConfirming(true); }}><Icon name="check" />受け取り完了</button>
              ) : (
                <div className="receive-confirm" role="alertdialog" aria-labelledby="receive-q">
                  <p id="receive-q"><b>{RECEIVE_CONFIRM}</b></p>
                  <div className="receive-actions">
                    <button type="button" className="btn-primary" onClick={() => void markReceived()} disabled={receiving} aria-busy={receiving}>{receiving ? "処理中…" : "受け取り完了にする"}</button>
                    <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={receiving}>戻る</button>
                  </div>
                </div>
              )}
              {receiveError && <div className="alert bad" role="alert"><Icon name="alert" />{receiveError}</div>}
            </section>
          )}
        </>
      )}
    </main>
  );
}
