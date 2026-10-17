import { formatJstDateTime, jstTimeOf } from "../../lib/dates.js";
import { rankingText } from "../../lib/reasons.js";
import type { Suggestion } from "../../lib/suggest.js";
import { BottomBar } from "../../components/BottomBar";
import { Icon } from "../../components/Icon";
import { exclusionSentence, PLAIN_NOTICE, PLAIN_REASON } from "./plain-text";
import type { Freshness, Shown } from "./types";

// STEP 3：仕入れ案。結論（状態と、何kg・何円か）→ 内訳（農家ごと）→ 金額 → 理由 → 候補に入らなかった農家。
// 数量・金額・状態・理由はすべてサーバーの通常ロジックの結果をそのまま表示する（AI は関与せず、画面でも判断を足さない）。
// 文言だけは画面用に平易な言葉へ置き換える（plain-text.ts。意味は変えない）。

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
  const overBudget = plan.reasonCodes.includes("OVER_BUDGET");
  const ranking = rankingText(plan.rankingReason);
  const lastUpdate = plan.supplySnapshot.length ? formatJstDateTime(plan.supplySnapshot.map((s) => s.updatedAt).sort().at(-1)!) : "—";

  // 状態バー：色と短い言葉で結果を示す（成功＝緑、足りない・案なし＝オレンジ、確認待ち＝黄、古い案＝灰）
  const tone = stale ? "stale" : ok ? "ok" : plan.status === "NEEDS_CONFIRMATION" ? "confirm" : "warn";
  const statusLabel = freshness === "stale" ? "この案は古くなりました" : freshness === "checking" ? "最新の情報か確認しています"
    : !hasPlan ? "案がありません" : plan.status === "MATCHED" ? "揃いました"
      : plan.status === "NEEDS_CONFIRMATION" ? "確認が必要です" : short ? "量が足りません" : "条件に合っていません";
  const statusIcon = stale ? "refresh" : ok ? "check" : "alert";

  // 結論の文：結果だけ読んでも意味が分かるように
  const title = !hasPlan ? (plan.reasonCodes.includes("TOO_MANY_SUPPLIES") ? "条件を絞ってください" : "この条件で組める案はありません")
    : plan.status === "MATCHED" ? `希望の${plan.requestedKg}kgを揃えられます`
      : plan.status === "NEEDS_CONFIRMATION" ? "確認が必要です"
        : short ? `あと${plan.shortageKg}kg足りません` : "条件に合う案になっていません";
  const sub = !hasPlan || plan.status === "MATCHED" ? null
    : plan.status === "NEEDS_CONFIRMATION" ? `${plan.fulfilledKg}kgの案がありますが、確認が必要です`
      : overBudget ? `予算内では${plan.fulfilledKg}kgまでなら用意できます` : `${plan.fulfilledKg}kgまでなら用意できます`;
  const scope = !ok && hasPlan && plan.status === "NOT_MATCHED" && !overBudget ? "この条件で、最大3つの農家まで組み合わせて探した結果です" : null;

  // この農家になった理由（既存の結果データを平易な文にするだけ）
  const why: { text: string; caution?: boolean }[] = [];
  for (const a of plan.allocations) if (a.priorTrade) why.push({ text: `${a.producerName}は取引経験あり（お店の申告）` });
  if (ranking) why.push({ text: ranking });
  if (hasPlan && plan.slot) why.push({ text: `同じ時間・場所（${plan.slot.label}・${plan.slot.placeName}）で受け取れる` });
  for (const c of plan.reasonCodes) {
    const names = c === "PARTICIPATION_UNCONFIRMED" && plan.unconfirmedParticipants.length > 0 ? `（${plan.unconfirmedParticipants.map((u) => u.producerName).join("・")}）` : "";
    why.push({ text: PLAIN_REASON[c] + names, caution: true });
  }
  if (plan.overBudget) why.push({ text: `予算を超えてもよい場合、${plan.overBudget.kg}kgの案は${plan.overBudget.totalYen === null ? "合計が未確定" : `合計${yen(plan.overBudget.totalYen)}`}です（予算 ${yen(plan.budgetYen ?? 0)}）`, caution: true });
  for (const n of plan.notices) why.push({ text: PLAIN_NOTICE[n], caution: true });

  const editIsPrimary = !stale && plan.status !== "MATCHED";
  const recalcLabel = busy ? busyLabel : <><Icon name="refresh" />最新の情報で計算し直す</>;

  return (
    <section className="result" aria-live="polite" aria-labelledby="result-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <h2 className="sr-only" id="result-title">仕入れ案</h2>

      {freshness === "stale" && (
        <div className="alert bad stale-banner" role="alert">
          <Icon name="alert" size={22} />
          <div style={{ display: "grid", gap: 10 }}>
            <strong className="stale-title">在庫の情報が変わりました</strong>
            <p>この案は今の情報ではありません。下の量と金額は使えません。</p>
            <button className="btn-primary btn-block" onClick={onRecalc} disabled={busy} aria-busy={busy}>{recalcLabel}</button>
          </div>
        </div>
      )}

      <div className={`result-body ${stale ? "is-stale" : ""}`}>
        {/* 1. 結論：状態バー → 結論の文 → 提案できる量・合計（いちばん大きい数字） */}
        <section className={`outcome ${tone}`} aria-labelledby="outcome-title">
          <p className="status-bar"><Icon name={statusIcon} size={22} strokeWidth={2.4} /><span className="sr-only">状態：</span>{statusLabel}</p>
          <p className="outcome-title" id="outcome-title">{freshness === "stale" ? "【無効】" : freshness === "checking" ? "【確認中】" : ""}{title}</p>
          {sub && <p className="outcome-sub">{sub}</p>}
          {hasPlan && (
            <dl className="key-figures">
              <div><dt>提案できる量</dt><dd className="kg"><Num stale={stale}>{plan.fulfilledKg}kg</Num></dd></div>
              <div><dt>合計（税込）</dt><dd className="yen">{plan.totalYen === null ? <span className="pending">未確定</span> : <Num stale={stale}>{yen(plan.totalYen)}</Num>}</dd></div>
            </dl>
          )}
          {scope && <p className="outcome-note">{scope}</p>}
          {hasPlan && plan.slot && (
            <p className="outcome-slot"><b>受け取り</b>{formatJstDateTime(plan.slot.startAt)}〜{jstTimeOf(plan.slot.endAt)}<br />{plan.slot.placeName}（{plan.slot.label}）</p>
          )}
        </section>

        {hasPlan && (
          <>
            {/* 2. 内訳：農家ごとに「名前・量・金額」の1行と、補足の1行 */}
            <section className="plain-section" aria-labelledby="breakdown-title">
              <h3 className="section-title" id="breakdown-title">内訳（{plan.producerCount}つの農家）</h3>
              <ul className="farm-rows">
                {plan.allocations.map((a) => (
                  <li key={a.supplyId} className="farm">
                    <div className="farm-line">
                      <b className="farm-name">{a.producerName}</b>
                      <span className="farm-kg num">{a.kg}kg</span>
                      <span className="farm-amount num">{yen(a.subtotalYen)}</span>
                    </div>
                    <p className="farm-detail">
                      {a.priceYenPerKg.toLocaleString("ja-JP")}円/kg・{a.priorTrade ? "取引経験あり（お店の申告）" : "初めての取引"}
                      {a.irregularReason && `・規格外（${a.irregularReason}）`}
                      {!a.participationConfirmed && <span className="caution-text">・受け取りへの参加確認が必要</span>}
                    </p>
                    <p className="farm-updated">在庫の更新 {formatJstDateTime(a.updatedAt)}</p>
                  </li>
                ))}
              </ul>
            </section>

            {/* 3. 金額 */}
            <section className="plain-section" aria-labelledby="money-title">
              <h3 className="section-title" id="money-title">金額</h3>
              <dl className="totals">
                <dt>商品代（税込）</dt><dd><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></dd>
                <dt>受け渡し費用（1回分）</dt><dd>{plan.handoverFeeYen === null ? "未確認" : <Num stale={stale}>{yen(plan.handoverFeeYen)}</Num>}</dd>
                <dt className="total">合計</dt><dd className="total">{plan.totalYen === null ? "未確定（確認が必要）" : <Num stale={stale}>{yen(plan.totalYen)}</Num>}</dd>
              </dl>
              {plan.budgetYen !== null && <p className="budget-line">予算 {yen(plan.budgetYen)}{plan.budgetStatus === "UNKNOWN" ? "（判定保留）" : "以内"}</p>}
              <div className="not-order">
                <Icon name="info" size={22} />
                <p><b>これは仕入れの案です。</b>注文や在庫の確保はまだしていません。取引の前に、各生産者に確認してください。</p>
              </div>
            </section>
          </>
        )}

        {/* 4. 理由 */}
        {why.length > 0 && (
          <section className="plain-section" aria-labelledby="why-title">
            <h3 className="section-title" id="why-title">{hasPlan ? "この農家になった理由" : "案にならなかった理由"}</h3>
            <ol className="reasons">
              {why.map((w) => <li key={w.text} className={w.caution ? "caution" : ""}>{w.text}</li>)}
            </ol>
          </section>
        )}

        {/* 5. 候補に入らなかった農家（安い在庫を使わない理由が分かるように） */}
        {plan.excluded.length > 0 && (
          <section className="plain-section" aria-labelledby="excluded-title">
            <h3 className="section-title" id="excluded-title">候補に入らなかった農家</h3>
            <ul className="excluded" aria-label="候補に入らなかった農家">
              {plan.excluded.map((e) => (
                <li key={e.supplyId} className="excluded-item">
                  <b>{e.producerName}</b><span>（{e.availableKg}kg・{e.priceYenPerKg.toLocaleString("ja-JP")}円/kg）</span>
                  <p className="why">{exclusionSentence(e.details)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {shown.suggestions.length > 0 && !stale && (
          <section className="plain-section" aria-labelledby="suggest-title">
            <h3 className="section-title" id="suggest-title">条件を変えるなら</h3>
            <p className="section-lead">選ぶと確認画面に入ります。自動で計算し直すことはありません。</p>
            <div className="cond-suggest">
              {shown.suggestions.map((s) => <button key={s.type} type="button" className="btn-secondary btn-block suggest" onClick={() => onSuggestion(s)}>{s.label}</button>)}
            </div>
          </section>
        )}

        <div className="foot-meta">
          <p className="computed-at">計算した時点：{formatJstDateTime(plan.computedAt)}{shown.demoClock && "（デモの基準日時）"}／在庫の最後の更新：{lastUpdate}</p>
          <p className="used-conditions">使った条件：{request.quantityKg}kg／{request.desiredDate}に受け取り／産地 {request.originPrefectures.join("・")}／予算 {request.budgetYen === null ? "上限なし" : yen(request.budgetYen)}／初めての農家 {request.allowFirstTime ? "含める" : "含めない"}／規格外 {request.allowIrregular ? "含める" : "含めない"}／品種 {request.allowMixedVarieties ? "まぜてよい" : "まぜない"}／規格 {request.allowMixedGrades ? "まぜてよい" : "まぜない"}</p>
        </div>
        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
      </div>

      {/* 次の行動は「計算し直す」と「条件を変える」だけ（注文・予約・送信はできない） */}
      <BottomBar className="next-actions">
        {editIsPrimary ? (
          <>
            <button type="button" className="btn-primary btn-block" onClick={onEdit}>条件を変更する</button>
            <button type="button" className="btn-secondary btn-block" onClick={onRecalc} disabled={busy} aria-busy={busy}>{recalcLabel}</button>
          </>
        ) : freshness === "stale" ? (
          <button type="button" className="btn-secondary btn-block" onClick={onEdit}>条件を変更する</button>
        ) : (
          <div className="bar-pair">
            <button type="button" className="btn-secondary" onClick={onRecalc} disabled={busy} aria-busy={busy}>{busy ? busyLabel : "計算し直す"}</button>
            <button type="button" className="btn-secondary" onClick={onEdit}>条件を変更する</button>
          </div>
        )}
      </BottomBar>
    </section>
  );
}
