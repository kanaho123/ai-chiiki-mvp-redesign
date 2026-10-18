import { useState } from "react";
import { Link, useParams } from "react-router";
import { nameOf } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import {
  STALE_RECHECK, confirmationLabel, consultationLabel, groupConsultations, isMatched, isOngoing, restaurantTodo, type Consultation, type Contact,
} from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { MatchBanner } from "../restaurant/MatchBanner";
import { PATHS } from "../../routes/paths";
import { useMe } from "../../routes/session";
import { ErrorRetry } from "./ErrorRetry";
import { WelcomeNotice } from "./WelcomeNotice";
import { useConfirmations, whenText, yen } from "./data";

// 飲食店のホーム・相談一覧・相談の詳細。
// 相談＝同じ仕入れ案で生産者に確認を依頼したもの。状態は「返事待ち／マッチ成立／一部対応できません／今回は対応できません」で表す。
// マッチ成立は全農家が「対応できます」のときだけ。それまでは農家ごとの状態で見せる。

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
          <p className="hint">全員が対応できなかった相談や、在庫・条件が変わった相談です。必要なら仕入れ案をつくり直してください。</p>
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
          {isMatched(c.farms)
            ? <MatchBanner farms={c.farms} onContactError={reload} />
            : <p className="hint">「対応できます」は注文の確定ではありません。受け渡しの詳細や最終確認は、農家と直接相談して決めてください。</p>}
          {c.status === "stale" && <div className="alert warn" role="status"><Icon name="alert" />{STALE_RECHECK}</div>}
          <ul className="farm-list">
            {c.farms.map((f) => (
              <li key={f.id} className={`farm-row farm-${f.status}`}>
                <div className="farm-head"><b>{f.producerName}</b><span className={`state-tag state-farm-${f.status}`}>{confirmationLabel[f.status]}</span></div>
                <p className="farm-detail">{f.quantityKg}kg・{yen(f.priceYenPerKg)}/kg・小計 {yen(f.subtotalYen)}（税込・受渡費別）</p>
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
              </li>
            ))}
          </ul>
          {contactError && <div className="alert bad" role="alert"><Icon name="alert" />{contactError}</div>}
          <p className="hint">商品代の合計 {yen(c.subtotalYen)}（税込・受渡費別）</p>
        </>
      )}
    </main>
  );
}
