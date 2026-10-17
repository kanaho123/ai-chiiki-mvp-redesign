import { Fragment } from "react";
import { formatJstDateTime, jstTimeOf } from "../../lib/dates.js";
import { EXCLUSION_TEXT, headlineText, NOTICE_TEXT, rankingText, REASON_TEXT, STATUS_TEXT } from "../../lib/reasons.js";
import type { Suggestion } from "../../lib/suggest.js";
import { BottomBar } from "../../components/BottomBar";
import { Icon } from "../../components/Icon";
import type { Freshness, Shown } from "./types";

// STEP 3：仕入れ案（仕入れ票）。状態・結論 → 明細 → 合計 → この案になった理由 → 使わなかった供給。
// 数量・金額・状態・理由はすべてサーバーの通常ロジックの結果をそのまま表示する（AI は関与せず、画面でも判断を足さない）。

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

export function PlanView({ shown, freshness, busy, busyLabel, error, onRecalc, onEdit, onSuggestion }: {
  shown: Shown; freshness: Freshness; busy: boolean; busyLabel: React.ReactNode; error: string | null;
  onRecalc: () => void; onEdit: () => void; onSuggestion: (s: Suggestion) => void;
}) {
  const { plan, request } = shown;
  // 古い案・確認中の案は、再計算するまで適合状態（MATCHED）を有効扱いしない
  const stale = freshness !== "fresh";
  const ok = plan.status === "MATCHED" && !stale;
  const hasPlan = plan.allocations.length > 0;
  const short = plan.status === "NOT_MATCHED" && hasPlan && plan.shortageKg > 0;
  const ranking = rankingText(plan.rankingReason);
  const lastUpdate = plan.supplySnapshot.length ? formatJstDateTime(plan.supplySnapshot.map((s) => s.updatedAt).sort().at(-1)!) : "—";

  // 状態は色だけでなく、アイコンと言葉でも伝える。不足・確認待ちに成功アイコン・成功色は使わない
  const status = freshness === "stale" ? "無効：この仕入れ案は現在の情報ではありません"
    : freshness === "checking" ? "最新の情報か確認中…" : STATUS_TEXT[plan.status];
  // 状態ラベル：意味がそのまま分かる短い言葉（色だけに頼らない）
  const statusLabel = freshness === "stale" ? "無効" : freshness === "checking" ? "確認中"
    : !hasPlan ? "該当なし" : plan.status === "MATCHED" ? "登録条件に適合"
      : plan.status === "NEEDS_CONFIRMATION" ? "確認が必要" : short ? `${plan.shortageKg}kg不足` : STATUS_TEXT[plan.status];
  const statusTone = stale ? "stale" : ok ? "ok" : plan.status === "NEEDS_CONFIRMATION" ? "confirm" : "warn";
  const title = !hasPlan ? "この条件で組める案はありません"
    : plan.status === "MATCHED" ? `${plan.fulfilledKg}kg 揃いました`
      : plan.status === "NEEDS_CONFIRMATION" ? "確認が必要です"
        : short ? `あと${plan.shortageKg}kg足りません` : headlineText(plan);
  const sub = !hasPlan ? null : plan.status === "MATCHED" ? null
    : plan.status === "NEEDS_CONFIRMATION" ? `${plan.fulfilledKg}kgの参考案があります` : `${plan.fulfilledKg}kgまで提案できます`;

  // この案になった理由（既存の結果データを文章にするだけ）
  const why: { text: string; caution?: boolean }[] = [];
  for (const a of plan.allocations) if (a.priorTrade) why.push({ text: `${a.producerName}は取引経験あり（店の申告）` });
  if (ranking) why.push({ text: ranking });
  if (hasPlan && plan.slot) why.push({ text: `同じ受渡枠（${plan.slot.label}・${plan.slot.placeName}）で受け取れる` });
  for (const c of plan.reasonCodes) {
    const names = c === "PARTICIPATION_UNCONFIRMED" && plan.unconfirmedParticipants.length > 0 ? `（${plan.unconfirmedParticipants.map((u) => u.producerName).join("・")}）` : "";
    why.push({ text: REASON_TEXT[c] + names, caution: true });
  }
  if (plan.overBudget) why.push({ text: `予算を外すと${plan.overBudget.kg}kgの案は${plan.overBudget.totalYen === null ? "総額未確定" : `総額${yen(plan.overBudget.totalYen)}`}です（予算 ${yen(plan.budgetYen ?? 0)}）`, caution: true });
  for (const n of plan.notices) why.push({ text: NOTICE_TEXT[n], caution: true });

  const editIsPrimary = !stale && plan.status !== "MATCHED";

  return (
    <section className="result" aria-live="polite" aria-labelledby="result-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <h2 className="sr-only" id="result-title">仕入れ案</h2>

      {freshness === "stale" && (
        <div className="alert bad stale-banner" role="alert">
          <Icon name="alert" />
          <div style={{ display: "grid", gap: 10 }}>
            <strong className="stale-title">供給情報が更新されています</strong>
            <p>この仕入れ案は現在の情報ではありません。下の数量・金額は使えません。</p>
            <button className="btn-primary btn-block" onClick={onRecalc} disabled={busy} aria-busy={busy}>
              {busy ? busyLabel : <><Icon name="refresh" />最新情報で再計算</>}
            </button>
          </div>
        </div>
      )}

      <div className={`result-body ${stale ? "is-stale" : ""}`} style={{ display: "grid", gap: "var(--gap)" }}>
        {/* 1〜4. 仕入れ票：状態ラベル → 結論 → 明細（生産者・数量・単価・金額）→ 商品代・受渡費・合計 */}
        <article className={`slip ${statusTone}`} aria-labelledby="slip-title">
          <div className="slip-head">
            <h3 className="slip-title" id="slip-title">仕入れ案</h3>
            <p className={`status-box ${statusTone}`} title={status}><span className="sr-only">状態：</span>{statusLabel}</p>
          </div>
          <dl className="slip-meta">
            {hasPlan && plan.slot && (
              <>
                <dt>受渡</dt><dd>{formatJstDateTime(plan.slot.startAt)}〜{jstTimeOf(plan.slot.endAt)}</dd>
                <dt>場所</dt><dd>{plan.slot.placeName}（{plan.slot.label}）</dd>
              </>
            )}
            <dt>計算</dt><dd>{formatJstDateTime(plan.computedAt)}</dd>
          </dl>

          <p className="slip-conclusion">
            {freshness === "stale" ? "【無効】" : freshness === "checking" ? "【確認中】" : ""}{title}
            {sub && <small>{sub}</small>}
            {!ok && <small className="headline">{headlineText(plan)}</small>}
          </p>

          {hasPlan && (
            <>
              <table className="slip-table">
                <caption className="sr-only">農家別の内訳（{plan.producerCount}農家）</caption>
                <thead>
                  <tr><th scope="col">生産者</th><th scope="col">数量</th><th scope="col">単価/kg</th><th scope="col">金額</th></tr>
                </thead>
                <tbody>
                  {plan.allocations.map((a) => (
                    <Fragment key={a.supplyId}>
                      <tr className="farm">
                        <th scope="row"><span className="farm-name">{a.producerName}</span></th>
                        <td className="qty"><span className="num">{a.kg}kg</span></td>
                        <td><span className="num">{a.priceYenPerKg.toLocaleString("ja-JP")}円</span></td>
                        <td className="amount"><span className="num">{yen(a.subtotalYen)}</span></td>
                      </tr>
                      <tr className="farm-sub-row">
                        <td colSpan={4}>
                          <span className="farm-sub">
                            <span className={`chip ${a.priorTrade ? "chip-prior" : "chip-first"}`}>{a.priorTrade ? "取引経験あり（店の申告）" : "初回"}</span>
                            {a.irregularReason && <span className="chip chip-warn">規格外：{a.irregularReason}</span>}
                            {!a.participationConfirmed && <span className="chip chip-need">受渡枠への参加確認が必要</span>}
                            <span className="farm-updated">供給更新 {formatJstDateTime(a.updatedAt)}</span>
                          </span>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>

              <dl className="slip-totals" aria-label="数量と金額">
                <dt>希望数量</dt><dd>{plan.requestedKg}kg</dd>
                <dt>提案数量</dt><dd><Num stale={stale}>{plan.fulfilledKg}kg</Num></dd>
                {plan.shortageKg > 0 && (<><dt className="short-row">不足</dt><dd className="short-row short">{plan.shortageKg}kg</dd></>)}
                <span className="totals-rule" aria-hidden="true" />
                <dt>商品代（税込）</dt><dd><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></dd>
                <dt>受渡費（1案に1回）</dt><dd>{plan.handoverFeeYen === null ? "未確認" : <Num stale={stale}>{yen(plan.handoverFeeYen)}</Num>}</dd>
              </dl>
              <div className="slip-total">
                <span>合計<small>税込・受渡費込み</small></span>
                {plan.totalYen === null ? <b className="pending">未確定（確認が必要）</b> : <b><Num stale={stale}>{yen(plan.totalYen)}</Num></b>}
              </div>
              {plan.budgetYen !== null && <p className="slip-budget muted small">予算 {yen(plan.budgetYen)}{plan.budgetStatus === "UNKNOWN" ? "（判定保留）" : "以内"}</p>}
            </>
          )}

          <div className="slip-note">
            <strong>検討用の案です</strong>
            <span>生産者への確認前・在庫未確保。登録情報をもとにした案で、注文・予約・在庫確保ではありません。</span>
          </div>
        </article>

        {/* 5. この案になった理由 */}
        {why.length > 0 && (
          <>
            <h3 className="section-title">{hasPlan ? "この案になった理由" : "理由"}</h3>
            <ul className="reasons">
              {why.map((w) => (
                <li key={w.text} className={w.caution ? "caution" : ""}>{w.text}</li>
              ))}
            </ul>
          </>
        )}

        {/* 6. 使わなかった供給（安い供給を使わない理由が分かるように） */}
        {plan.excluded.length > 0 && (
          <>
            <h3 className="section-title">今回は使わなかった供給</h3>
            <ul className="excluded" aria-label="今回は使わなかった供給">
              {plan.excluded.map((e) => (
                <li key={e.supplyId} className="excluded-item">
                  <b>{e.producerName}</b><span className="muted small">（{e.availableKg}kg・{e.priceYenPerKg.toLocaleString("ja-JP")}円/kg）</span>
                  <p className="why">{e.details.map((d) => EXCLUSION_TEXT[d]).join("、")}</p>
                </li>
              ))}
            </ul>
          </>
        )}

        {shown.suggestions.length > 0 && !stale && (
          <>
            <h3 className="section-title">条件を変更するなら</h3>
            <p className="muted small">選ぶと確認画面に反映されます。勝手に条件を変えて計算することはありません。</p>
            <div className="cond-suggest">
              {shown.suggestions.map((s) => <button key={s.type} type="button" className="suggest" onClick={() => onSuggestion(s)}>{s.label}</button>)}
            </div>
          </>
        )}

        <div className="foot-meta">
          <p className="computed-at">計算時点 {formatJstDateTime(plan.computedAt)}{shown.demoClock && "（デモ基準日時）"}の登録情報／供給の最終更新 {lastUpdate}</p>
          <p className="used-conditions">使った条件：{request.quantityKg}kg／{request.desiredDate}受取／産地 {request.originPrefectures.join("・")}／予算 {request.budgetYen === null ? "上限なし" : yen(request.budgetYen)}／初回{request.allowFirstTime ? "含める" : "含めない"}／規格外{request.allowIrregular ? "可" : "不可"}／品種混在{request.allowMixedVarieties ? "可" : "不可"}／規格混在{request.allowMixedGrades ? "可" : "不可"}</p>
        </div>
        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
      </div>

      {/* 次の行動は「再計算」と「条件を変更」だけ（注文・予約・送信はできない） */}
      <BottomBar className="next-actions">
          {editIsPrimary ? (
            <>
              <button type="button" className="btn-primary btn-block" onClick={onEdit}>条件を変更する<Icon name="arrowRight" /></button>
              <button type="button" className="btn-link btn-block" onClick={onRecalc} disabled={busy} aria-busy={busy}>{busy ? busyLabel : "最新情報で再計算"}</button>
            </>
          ) : freshness === "stale" ? (
            <button type="button" className="btn-link btn-block" onClick={onEdit}>条件を変更する</button>
          ) : (
            <>
              <button type="button" className="btn-secondary btn-block" onClick={onRecalc} disabled={busy} aria-busy={busy}>{busy ? busyLabel : <><Icon name="refresh" />最新情報で再計算</>}</button>
              <button type="button" className="btn-link btn-block" onClick={onEdit}>条件を変更する</button>
            </>
          )}
      </BottomBar>
    </section>
  );
}
