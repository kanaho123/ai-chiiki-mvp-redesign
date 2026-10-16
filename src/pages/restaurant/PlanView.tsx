import { PLAN_NOTICE } from "../../lib/constants.js";
import { formatJstDateTime, jstTimeOf } from "../../lib/dates.js";
import { EXCLUSION_TEXT, headlineText, NOTICE_TEXT, rankingText, REASON_TEXT, STATUS_TEXT } from "../../lib/reasons.js";
import type { Suggestion } from "../../lib/suggest.js";
import { Icon } from "../../components/Icon";
import type { Freshness, Shown } from "./types";

// STEP 3：仕入れ案。数量・金額・状態・理由はすべてサーバーの通常ロジックの結果をそのまま表示する（AI は関与しない）。

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/** 無効な案の数値には取り消し線と「無効」を付ける */
function Num({ children, stale }: { children: React.ReactNode; stale: boolean }) {
  return (
    <>
      <span className="num">{children}</span>
      {stale && <span className="void-mark">無効</span>}
    </>
  );
}

export function PlanView({ shown, freshness, busy, busyLabel, onRecalc, onEdit, onSuggestion }: {
  shown: Shown; freshness: Freshness; busy: boolean; busyLabel: React.ReactNode;
  onRecalc: () => void; onEdit: () => void; onSuggestion: (s: Suggestion) => void;
}) {
  const { plan, request } = shown;
  // 古い案・確認中の案は、再計算するまで適合状態（MATCHED）を有効扱いしない
  const stale = freshness !== "fresh";
  const ok = plan.status === "MATCHED" && !stale;
  const tone = freshness === "stale" ? "bad" : freshness === "checking" ? "warn" : ok ? "ok" : "warn";
  // 状態は色だけでなく、アイコンと言葉でも伝える。不足・確認待ちに成功アイコンは使わない
  const status = freshness === "stale"
    ? { icon: "x" as const, text: "無効：この仕入れ案は現在の情報ではありません" }
    : freshness === "checking"
      ? { icon: "refresh" as const, text: "最新の情報か確認中…" }
      : { icon: ok ? ("check" as const) : ("alert" as const), text: STATUS_TEXT[plan.status] };
  const ranking = rankingText(plan.rankingReason);

  return (
    <section className="result" aria-live="polite" aria-labelledby="result-title">
      <h2 className="result-title" id="result-title"><span className="step-no">3</span>仕入れ案</h2>

      {freshness === "stale" && (
        <div className="alert bad stale-banner" role="alert">
          <Icon name="alert" />
          <div>
            <strong className="stale-title">供給情報が更新されています</strong>
            <p>この仕入れ案は現在の情報ではありません。下の数量・金額は使えません。最新情報で再計算してください。</p>
            <button className="primary block" onClick={onRecalc} disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>
              {busy ? busyLabel : <><Icon name="refresh" />最新情報で再計算</>}
            </button>
          </div>
        </div>
      )}

      <div className={`result-body ${stale ? "is-stale" : ""}`}>
        <div className={`hero summary ${tone}`}>
          <p className={`status ${tone}`}><Icon name={status.icon} />{status.text}</p>
          <p className="headline">{freshness === "stale" ? "【無効】" : freshness === "checking" ? "【確認中】" : ""}{headlineText(plan)}</p>

          <dl className="keyfacts">
            <div className="kf kf-qty">
              <dt>案の数量</dt>
              <dd>
                <span className="figure"><Num stale={stale}>{plan.fulfilledKg}<small>kg</small></Num></span>
                <span className="of">／ 希望 {plan.requestedKg}kg{plan.shortageKg > 0 && `（${plan.shortageKg}kg不足）`}</span>
              </dd>
            </div>
            <div className="kf">
              <dt>総額（税込・受渡費用込み）</dt>
              <dd className={ok ? "price" : "price price-sub"}>
                {plan.allocations.length === 0 ? <span className="muted">—</span> : plan.totalYen === null ? "総額未確定（確認が必要）" : <Num stale={stale}>{yen(plan.totalYen)}</Num>}
              </dd>
            </div>
            <div className="kf kf-handover">
              <dt>受渡し</dt>
              <dd>
                {plan.slot ? (
                  <>
                    <span className="kf-line"><Icon name="calendar" size={18} />{formatJstDateTime(plan.slot.startAt)}〜{jstTimeOf(plan.slot.endAt)}</span>
                    <span className="kf-line"><Icon name="pin" size={18} />{plan.slot.placeName}（{plan.slot.label}）</span>
                  </>
                ) : (
                  <span className="muted">受渡枠が見つかりません</span>
                )}
              </dd>
            </div>
          </dl>

          <p className="status-line"><Icon name="info" size={18} /><strong>{PLAN_NOTICE}</strong></p>
        </div>
        <p className="status-detail">この仕入れ案は登録情報をもとにした検討用です。実際の取引は各生産者への確認が必要です。品質の保証や在庫の予約ではありません。</p>

        {plan.reasonCodes.length > 0 && (
          <section className="section" aria-labelledby="reason-title">
            <h3 id="reason-title">理由</h3>
            <ul className="plain">
              {plan.reasonCodes.map((c) => (
                <li key={c}>
                  {REASON_TEXT[c]}
                  {c === "PARTICIPATION_UNCONFIRMED" && plan.unconfirmedParticipants.length > 0 &&
                    `（${plan.unconfirmedParticipants.map((u) => u.producerName).join("・")}）`}
                </li>
              ))}
              {plan.overBudget && (
                <li>予算を外すと{plan.overBudget.kg}kgの案は{plan.overBudget.totalYen === null ? "総額未確定" : `総額${yen(plan.overBudget.totalYen)}`}です（予算 {yen(plan.budgetYen ?? 0)}）</li>
              )}
            </ul>
          </section>
        )}

        {ranking && !stale && <div className="alert ok" role="note"><Icon name="info" />{ranking}</div>}
        {plan.notices.map((n) => <div className="alert warn" key={n}><Icon name="alert" />{NOTICE_TEXT[n]}</div>)}

        {plan.allocations.length > 0 && (
          <section className="section" aria-labelledby="alloc-title">
            <h3 id="alloc-title">農家別の配分<span className="muted">（{plan.producerCount}農家）</span></h3>
            <ul className="farm-cards">
              {plan.allocations.map((a) => (
                <li key={a.supplyId} className="farm-card">
                  <div className="farm-card-top">
                    <span className="name">{a.producerName}</span>
                    <span className="farm-kg"><Num stale={stale}>{a.kg}<small>kg</small></Num></span>
                  </div>
                  <div className="farm-tags">
                    <span className={`tag ${a.priorTrade ? "on" : "off"}`}>{a.priorTrade ? "取引経験あり（店の申告）" : "初回"}</span>
                    {a.irregularReason && <span className="tag irregular">規格外：{a.irregularReason}</span>}
                    {!a.participationConfirmed && <span className="tag irregular">受渡枠への参加確認が必要</span>}
                  </div>
                  <dl className="farm-meta">
                    <dt>単価</dt><dd>{a.priceYenPerKg.toLocaleString("ja-JP")}円/kg（{a.varietyName}）</dd>
                    <dt>商品代</dt><dd><Num stale={stale}>{yen(a.subtotalYen)}</Num></dd>
                    <dt>供給の更新</dt><dd>{formatJstDateTime(a.updatedAt)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.allocations.length > 0 && (
          <section className="section" aria-labelledby="money-title">
            <h3 id="money-title">金額</h3>
            <dl className="price-rows">
              <dt>商品代（税込）</dt><dd><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></dd>
              <dt>受渡費（1案につき1回）</dt><dd>{plan.handoverFeeYen === null ? "未確認" : <Num stale={stale}>{yen(plan.handoverFeeYen)}</Num>}</dd>
              <dt>総額</dt><dd>{plan.totalYen === null ? "総額未確定（確認が必要）" : <Num stale={stale}>{yen(plan.totalYen)}</Num>}</dd>
              {plan.budgetYen !== null && (
                <>
                  <dt>予算</dt>
                  <dd>{yen(plan.budgetYen)}{plan.budgetStatus === "UNKNOWN" ? "（総額未確定のため判定保留）" : "以内"}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {plan.excluded.length > 0 && (
          <section className="section" aria-labelledby="excluded-title">
            <h3 id="excluded-title">使わなかった供給と理由</h3>
            <ul className="plain">
              {plan.excluded.map((e) => (
                <li key={e.supplyId}>{e.producerName}（{e.availableKg}kg・{e.priceYenPerKg}円/kg）：{e.details.map((d) => EXCLUSION_TEXT[d]).join("、")}</li>
              ))}
            </ul>
          </section>
        )}

        {shown.suggestions.length > 0 && !stale && (
          <section className="section suggestion" aria-labelledby="sugg-title">
            <h3 id="sugg-title">条件を変更する場合の候補</h3>
            <p className="hint">選ぶと条件確認の画面に反映されます。勝手に条件を変えて計算することはありません。</p>
            <div className="qform-tools">
              {shown.suggestions.map((s) => (
                <button key={s.type} type="button" className="ghost" onClick={() => onSuggestion(s)}>{s.label}</button>
              ))}
            </div>
          </section>
        )}

        <p className="used-conditions">
          計算時点：{formatJstDateTime(plan.computedAt)}{shown.demoClock && "（デモ用の基準日時）"}の情報。
          供給の最終更新：{plan.supplySnapshot.length ? formatJstDateTime(plan.supplySnapshot.map((s) => s.updatedAt).sort().at(-1)!) : "—"}
        </p>
        <p className="used-conditions">
          使った条件：{request.quantityKg}kg／{request.desiredDate}受取／産地 {request.originPrefectures.join("・")}／予算 {request.budgetYen === null ? "上限なし" : yen(request.budgetYen)}
          ／初回{request.allowFirstTime ? "含める" : "含めない"}／規格外{request.allowIrregular ? "可" : "不可"}／品種混在{request.allowMixedVarieties ? "可" : "不可"}／規格混在{request.allowMixedGrades ? "可" : "不可"}
        </p>
      </div>

      {/* 次の行動は「再計算」と「条件を変更」だけ（注文・予約・送信はできない） */}
      <div className="next-actions">
        {freshness !== "stale" && (
          <button type="button" className="secondary block" onClick={onRecalc} disabled={busy} aria-busy={busy}>
            {busy ? busyLabel : <><Icon name="refresh" />最新情報で再計算</>}
          </button>
        )}
        <button type="button" className="ghost block" onClick={onEdit}>条件を変更</button>
      </div>
    </section>
  );
}
