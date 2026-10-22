import { useRef, useState } from "react";
import { Link } from "react-router";
import { nameOf } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { classifyRequests, conditionChips, confirmationLabel, type Confirmation } from "../../lib/approvals";
import { formatDateJa } from "../../lib/dates";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { useInbox } from "../../routes/inbox";
import { PATHS } from "../../routes/paths";
import { useMe, useSession } from "../../routes/session";
import { ErrorRetry } from "./ErrorRetry";
import { TradeChat } from "./TradeChat";
import { TradeReviewBox } from "./TradeReviewBox";
import { WelcomeNotice } from "./WelcomeNotice";
import { useConfirmations, useSupplies, whenText, yen } from "./data";

// 生産者のホームと「依頼」。新しい相談は、ベルではなくホームの最上部と下部ナビの数で知らせる。
// ボタンは「対応できます」「今回は対応できません」（「承認」「NG」などの言葉は使わない）。

/** 相談1件の内容（飲食店・品目・数量・希望日・金額・受け渡し・飲食店の仕入れ条件）。条件は依頼のときに保存したものだけを出す */
function RequestBody({ r }: { r: Confirmation }) {
  const c = r.conditions;
  return (
    <>
      <div className="farm-head"><b>{r.restaurantName}</b>{r.receivedAt
        ? <span className="state-tag state-completed">取引完了</span>
        : <span className={`state-tag state-farm-${r.status}`}>{confirmationLabel[r.status]}</span>}</div>
      <p className="request-what">{r.itemName} {r.quantityKg}kg</p>
      {c && c.requestedKg !== r.quantityKg && <p className="farm-detail">飲食店が必要な量 {c.requestedKg}kg のうち、あなたへの相談は {r.quantityKg}kg</p>}
      {c && <p className="farm-detail">希望日：{formatDateJa(c.desiredDate)}</p>}
      <p className="farm-detail">{yen(r.priceYenPerKg)}/kg・商品代 {yen(r.subtotalYen)}（税込・受け渡し費用は別）</p>
      <p className="farm-detail">{whenText(r.pickupStartAt, r.pickupEndAt)}・{r.pickupPlace}</p>
      {c && conditionChips(c).length > 0 && (
        <ul className="request-conds" aria-label="飲食店の仕入れ条件">
          {conditionChips(c).map((x) => <li key={x.label}><span>{x.label}</span><b>{x.value}</b></li>)}
        </ul>
      )}
    </>
  );
}

export function ProducerHome() {
  const me = useMe();
  const { demoNow, appMode } = useSession();
  const requests = useConfirmations();
  const supplies = useSupplies();
  const pending = requests.data ? classifyRequests(requests.data).pending : null;
  const now = demoNow ? new Date(demoNow) : new Date();
  const nextSlot = supplies.data?.slots.filter((s) => new Date(s.startAt) > now).sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  const listings = supplies.data?.supplies ?? [];
  const usual = supplies.data?.places ?? [];
  const hasPending = !!pending && pending.length > 0;

  return (
    <main className="screen home">
      <div className="title-block">
        <span className="eyebrow">ホーム</span>
        <h1 className="display">{nameOf(me)}</h1>
      </div>
      <WelcomeNotice role="producer" text="さっそく、農産物を出品してみましょう。" />

      {/* いちばん大事な操作は1つだけ、画面の最初に大きく置く */}
      <Link className="btn-primary btn-block link-btn home-main" to={PATHS.producer.newListing}>
        <Icon name="box" size={28} />
        <span className="home-main-text"><b>農産物を出品する</b><small>写真・声・手入力で</small></span>
      </Link>
      {(requests.error || supplies.error) && <ErrorRetry text={(requests.error ?? supplies.error)!} onRetry={() => Promise.all([requests.reload(), supplies.reload()])} />}

      {/* 飲食店から届いた仕入れ相談（返事が必要なもの） */}
      <section aria-labelledby="pending-title">
        <h2 className="section-title" id="pending-title">飲食店からの仕入れ相談</h2>
        {!pending && !requests.error && <p className="muted" aria-busy="true">読み込み中…</p>}
        {pending && !hasPending && <p className="empty-note">いま返事が必要な相談はありません</p>}
        {hasPending && (
          <>
            <div className="new-requests" role="status">
              <Icon name="clipboard" size={26} />
              <div><b>あなたの出品条件に合う仕入れ相談が{pending!.length}件あります</b><br />飲食店があなたの返事を待っています。</div>
            </div>
            <ul className="request-list compact">
              {pending!.slice(0, 3).map((r) => <li key={r.id} className="farm-row"><RequestBody r={r} /></li>)}
            </ul>
            <Link className="btn-secondary btn-block link-btn" to={PATHS.producer.requests}><Icon name="clipboard" />相談に返事をする</Link>
          </>
        )}
      </section>

      <section aria-labelledby="listing-title">
        <h2 className="section-title" id="listing-title">いまの出品</h2>
        {supplies.data && listings.length === 0 && <p className="empty-note">まだ出品はありません</p>}
        {listings.length > 0 && (
          <ul className="listing-rows">
            {listings.map((s) => (
              <li key={s.id}>
                <span className="listing-name">{s.item.name}{s.variety.name !== "指定なし" && `（${s.variety.name}）`}</span>
                <span className="listing-kg">{s.availableKg}kg</span>
                <span className={`listing-state ${s.published ? "on" : "off"}`}>{s.published ? `公開中・${yen(s.priceYenPerKg)}/kg` : "公開していません"}</span>
              </li>
            ))}
          </ul>
        )}
        {listings.length > 0 && <Link className="text-btn link-btn" to={PATHS.producer.listings}>量や価格を変える<Icon name="chevronRight" /></Link>}
      </section>

      <section aria-labelledby="slot-title">
        <h2 className="section-title" id="slot-title">次の受け渡し</h2>
        {/* 一般向け：いつもの受け渡し場所（登録した場所）。未登録なら、はじめての出品のときに聞く（ここでは状態だけ知らせる） */}
        {supplies.data && appMode === "general" && (usual.length === 0
          ? <p className="usual-status"><b>いつもの受け渡し場所：未登録</b><br /><span className="muted">はじめて出品するときに登録できます。</span></p>
          : <p className="usual-status"><b>いつもの受け渡し場所：{usual.map((p) => p.name).join("・")}</b></p>)}
        {supplies.data && !nextSlot && <p className="empty-note">予定している受け渡しはありません</p>}
        {nextSlot && <p className="next-slot"><b>{whenText(nextSlot.startAt, nextSlot.endAt)}</b><br />{nextSlot.placeName}</p>}
      </section>
    </main>
  );
}

export function ProducerRequests() {
  const { appMode } = useSession();
  const { data, error, reload } = useConfirmations();
  const inbox = useInbox();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const locked = useRef(false);
  const groups = data ? classifyRequests(data) : null;

  async function respond(id: string, status: "approved" | "rejected") {
    if (locked.current) return;
    locked.current = true;
    setBusy(id);
    setMessage(null);
    const shop = data?.find((r) => r.id === id)?.restaurantName ?? "飲食店";
    try {
      await confirmationApi(`/api/approvals/${encodeURIComponent(id)}`, "PATCH", { status });
      setMessage({ tone: "ok", text: status === "approved"
        ? `${shop}の仕入れ相談に「対応できます」と回答しました。${shop}に、あなたの連絡先が表示されます。注文の確定や在庫の確保にはなりません。`
        : `${shop}の仕入れ相談に「今回は対応できません」と回答しました。` });
    } catch (e) {
      setMessage({ tone: "bad", text: friendlyError(e, "返事を送れませんでした。もう一度お試しください") });
    } finally {
      await reload();
      inbox.refresh();
      locked.current = false;
      setBusy(null);
    }
  }

  return (
    <main className="screen">
      <div className="title-block">
        <h1 className="display">依頼</h1>
        <p className="muted">飲食店からの相談です。「対応できます」と返事をすると、その飲食店にだけあなたの連絡先が表示されます。注文の確定や在庫の確保にはなりません。</p>
        {appMode === "general" && <p className="hint">表示する連絡先は、マイページで確認・変更できます。</p>}
      </div>
      {message && <div className={`alert ${message.tone}`} role={message.tone === "bad" ? "alert" : "status"}><Icon name={message.tone === "ok" ? "check" : "alert"} />{message.text}</div>}
      {error && <ErrorRetry text={error} onRetry={reload} />}
      {!groups && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {groups && (
        <>
          <section aria-labelledby="r-pending">
            <h2 className="section-title" id="r-pending">未対応（{groups.pending.length}件）</h2>
            {groups.pending.length === 0 && <p className="empty-note">返事が必要な相談はありません</p>}
            <ul className="request-list">
              {groups.pending.map((r) => (
                <li key={r.id} className="farm-row">
                  <RequestBody r={r} />
                  <div className="request-actions">
                    <button type="button" className="btn-primary" disabled={busy !== null} aria-busy={busy === r.id} onClick={() => respond(r.id, "approved")}><Icon name="check" />対応できます</button>
                    <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => respond(r.id, "rejected")}>今回は対応できません</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="r-accepted">
            <h2 className="section-title" id="r-accepted">対応済（{groups.accepted.length}件）</h2>
            {groups.accepted.length === 0 ? <p className="empty-note">まだありません</p> : (
              <ul className="request-list">{groups.accepted.map((r) => (
                <li key={r.id} className="farm-row">
                  <RequestBody r={r} />
                  {r.receivedAt && <p className="trade-done-note" role="status"><Icon name="check" />取引完了：飲食店が受け取りを完了しました</p>}
                  {r.receivedAt && r.established && <TradeReviewBox requestId={r.id} partnerName={r.restaurantName} role="producer" />}
                  {r.established
                    ? <TradeChat requestId={r.id} partnerName={r.restaurantName} completed={!!r.receivedAt} />
                    : <p className="hint">この仕入れ案のほかの農家の返事がそろうと、飲食店とやり取りできるようになります。</p>}
                </li>
              ))}</ul>
            )}
          </section>
          <section aria-labelledby="r-declined">
            <h2 className="section-title" id="r-declined">今回は難しい（{groups.declined.length}件）</h2>
            {groups.declined.length === 0 ? <p className="empty-note">まだありません</p> : (
              <ul className="request-list">{groups.declined.map((r) => <li key={r.id} className="farm-row"><RequestBody r={r} /></li>)}</ul>
            )}
          </section>
          {groups.closed.length > 0 && (
            <details className="more-info closed-requests">
              <summary>条件が変わって終わった相談（{groups.closed.length}件）<Icon name="chevronDown" /></summary>
              <p className="hint">在庫や条件が変わったため、返事はできません。飲食店からの新しい相談をお待ちください。</p>
              <ul className="request-list">{groups.closed.map((r) => <li key={r.id} className="farm-row"><RequestBody r={r} /></li>)}</ul>
            </details>
          )}
        </>
      )}
    </main>
  );
}
