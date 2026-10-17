import { formatDateJa, formatJstDateTime, jstDateOf, jstTimeOf } from "../../lib/dates.js";
import { rankingText } from "../../lib/reasons.js";
import type { Suggestion } from "../../lib/suggest.js";
import { BottomBar } from "../../components/BottomBar";
import { Icon } from "../../components/Icon";
import { exclusionSentence, PLAIN_NOTICE, PLAIN_REASON, rankingSummary } from "./plain-text";
import type { Freshness, Shown } from "./types";

// STEP 3：仕入れ案。最初に答え（何kg・いくら・どの農家）だけを1枚のカードで見せ、
// その下に 農家ごとの内訳 → なぜこの組み合わせ？（1行＋詳しく見る）→ 候補外・計算の条件（閉じた状態）を置く。
// 数量・金額・状態・理由はサーバーの通常ロジックの結果をそのまま使い、文言だけ画面用に言い換える（plain-text.ts）。

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

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
  const lastUpdate = plan.supplySnapshot.length ? formatJstDateTime(plan.supplySnapshot.map((s) => s.updatedAt).sort().at(-1)!) : "—";

  // 答えの見出し（色＝状態：揃った＝緑、足りない・案なし＝オレンジ、確認待ち＝黄、古い案＝灰）
  const tone = stale ? "stale" : ok ? "ok" : plan.status === "NEEDS_CONFIRMATION" ? "confirm" : "warn";
  const statusIcon = stale ? "refresh" : ok ? "check" : "alert";
  const headline = !hasPlan ? (plan.reasonCodes.includes("TOO_MANY_SUPPLIES") ? "条件を絞ってください" : "この条件で組める案はありません")
    : plan.status === "MATCHED" ? `${plan.fulfilledKg}kg 揃いました`
      : plan.status === "NEEDS_CONFIRMATION" ? "確認が必要です"
        : short ? `あと${plan.shortageKg}kg 足りません` : "条件に合う案になっていません";
  const sub = !hasPlan || plan.status === "MATCHED" ? null
    : plan.status === "NEEDS_CONFIRMATION" ? `${plan.fulfilledKg}kgの案があります`
      : overBudget ? `予算内では${plan.fulfilledKg}kgまでなら用意できます` : `${plan.fulfilledKg}kgまでなら用意できます`;
  const prefix = freshness === "stale" ? "【無効】" : freshness === "checking" ? "【確認中】" : "";

  // なぜこの組み合わせ？：1行目は計算結果から作る短い文。揃わなかったときは、その理由を1行目にする
  const firstCaution = plan.reasonCodes[0];
  const summary = (!ok && firstCaution ? PLAIN_REASON[firstCaution] : null) ?? rankingSummary(plan) ?? (firstCaution ? PLAIN_REASON[firstCaution] : null);
  const details: { text: string; caution?: boolean }[] = [];
  for (const a of plan.allocations) if (a.priorTrade) details.push({ text: `${a.producerName}は取引経験あり（お店の申告）` });
  const ranking = rankingText(plan.rankingReason);
  if (ranking && summary !== rankingSummary(plan)) details.push({ text: ranking });
  if (hasPlan && plan.slot) details.push({ text: `同じ時間・場所（${plan.slot.label}・${plan.slot.placeName}）で受け取れる` });
  for (const c of plan.reasonCodes) {
    if (PLAIN_REASON[c] === summary) continue;
    const names = c === "PARTICIPATION_UNCONFIRMED" && plan.unconfirmedParticipants.length > 0 ? `（${plan.unconfirmedParticipants.map((u) => u.producerName).join("・")}）` : "";
    details.push({ text: PLAIN_REASON[c] + names, caution: true });
  }
  if (plan.overBudget) details.push({ text: `予算を超えてもよい場合、${plan.overBudget.kg}kgの案は${plan.overBudget.totalYen === null ? "合計が未確定" : `合計${yen(plan.overBudget.totalYen)}`}です（予算 ${yen(plan.budgetYen ?? 0)}）`, caution: true });
  for (const n of plan.notices) details.push({ text: PLAIN_NOTICE[n], caution: true });

  const editIsPrimary = !stale && plan.status !== "MATCHED";
  const recalcLabel = busy ? busyLabel : <><Icon name="refresh" />最新の情報で計算し直す</>;
  const suggestions = shown.suggestions.length > 0 && !stale ? (
    <section className="suggest-block" aria-labelledby="suggest-title">
      <h3 className="block-title" id="suggest-title">条件を変えるなら</h3>
      <div className="cond-suggest">
        {shown.suggestions.map((s) => <button key={s.type} type="button" className="btn-secondary btn-block suggest" onClick={() => onSuggestion(s)}>{s.label}<Icon name="arrowRight" /></button>)}
      </div>
    </section>
  ) : null;

  return (
    <section className="result" aria-live="polite" aria-labelledby="result-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <h2 className="sr-only" id="result-title">仕入れ案</h2>

      {freshness === "stale" && (
        <div className="alert bad stale-banner" role="alert">
          <Icon name="alert" size={22} />
          <div style={{ display: "grid", gap: 10 }}>
            <strong className="stale-title">在庫が変わりました</strong>
            <button className="btn-primary btn-block" onClick={onRecalc} disabled={busy} aria-busy={busy}>{recalcLabel}</button>
          </div>
        </div>
      )}

      <div className={`result-body ${stale ? "is-stale" : ""}`}>
        {/* 1. 答え：何kg・いくら・どの農家（このカードだけで分かる） */}
        <section className={`answer ${tone}`} aria-labelledby="answer-title">
          <p className="answer-head" id="answer-title"><Icon name={statusIcon} size={26} strokeWidth={2.4} />{prefix}{headline}</p>
          <div className="answer-body">
            {sub && <p className="answer-sub">{sub}</p>}
            {hasPlan && (
              <p className="answer-yen">
                <span className="sr-only">合計（税込）</span>
                {plan.totalYen === null ? <span className="pending">合計は未確定</span> : <Num stale={stale}>{yen(plan.totalYen)}</Num>}
                <small>税込・受け渡し費用込み</small>
              </p>
            )}
            {hasPlan && <p className="answer-lineup"><span className="num">{plan.allocations.map((a) => `${a.producerName} ${a.kg}kg`).join(" ＋ ")}</span></p>}
            {hasPlan && plan.slot && (
              <p className="answer-meta">
                <span><Icon name="calendar" size={20} />{formatDateJa(jstDateOf(plan.slot.startAt))} {jstTimeOf(plan.slot.startAt)}〜{jstTimeOf(plan.slot.endAt)}</span>
                <span><Icon name="pin" size={20} />{plan.slot.placeName}</span>
              </p>
            )}
            {hasPlan && <p className="answer-tag"><Icon name="info" size={18} />注文前の案・在庫は未確保</p>}
          </div>
        </section>

        {!ok && suggestions}

        {hasPlan && (
          <>
            {/* 2. 農家ごとの内訳：小さなカードを横に並べる */}
            <section aria-labelledby="farms-title">
              <h3 className="block-title" id="farms-title">内訳</h3>
              <ul className="farm-cards">
                {plan.allocations.map((a) => (
                  <li key={a.supplyId} className="farm">
                    <b className="farm-name">{a.producerName}</b>
                    <span className="farm-kg num">{a.kg}kg</span>
                    <span className="farm-amount num">{yen(a.subtotalYen)}</span>
                    <span className="farm-unit">{yen(a.priceYenPerKg)}/kg</span>
                    <span className={`farm-tag ${a.priorTrade ? "prior" : "first"}`}>{a.priorTrade ? "取引あり" : "初めて"}</span>
                    {a.irregularReason && <span className="farm-note">規格外（{a.irregularReason}）</span>}
                    {!a.participationConfirmed && <span className="farm-note caution-text">受け取りへの参加確認が必要</span>}
                  </li>
                ))}
              </ul>
              <dl className="money-rows">
                <dt>商品代</dt><dd><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></dd>
                <dt>受け渡し費用</dt><dd>{plan.handoverFeeYen === null ? "未確認" : <Num stale={stale}>{yen(plan.handoverFeeYen)}</Num>}</dd>
                {plan.budgetYen !== null && <><dt>予算</dt><dd>{yen(plan.budgetYen)}{plan.budgetStatus === "UNKNOWN" ? "（判定保留）" : "以内"}</dd></>}
              </dl>
            </section>
          </>
        )}

        {/* 3. なぜこの組み合わせ？：1行は最初から見せ、詳しい理由は開いたときだけ */}
        {summary && (
          <section className="why-block" aria-labelledby="why-title">
            <h3 className="block-title" id="why-title"><Icon name="info" size={22} />{hasPlan ? "なぜこの組み合わせ？" : "なぜ案がないの？"}</h3>
            <p className="why-summary">{summary}</p>
            {details.length > 0 && (
              <details className="more-info">
                <summary>詳しく見る<Icon name="chevronDown" size={20} /></summary>
                <ul className="reasons">
                  {details.map((w) => <li key={w.text} className={w.caution ? "caution" : ""}>{w.text}</li>)}
                </ul>
              </details>
            )}
          </section>
        )}

        {ok && suggestions}

        {/* 4. 候補外・計算の条件：閉じた状態 */}
        {plan.excluded.length > 0 && (
          <details className="more-info fold">
            <summary>候補に入らなかった農家（{plan.excluded.length}件）<Icon name="chevronDown" size={20} /></summary>
            <ul className="excluded" aria-label="候補に入らなかった農家">
              {plan.excluded.map((e) => (
                <li key={e.supplyId} className="excluded-item">
                  <b>{e.producerName}</b><span>（{e.availableKg}kg・{yen(e.priceYenPerKg)}/kg）</span>
                  <p className="why">{exclusionSentence(e.details)}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
        <details className="more-info fold foot-meta">
          <summary>計算の条件<Icon name="chevronDown" size={20} /></summary>
          <p className="computed-at">計算した時点：{formatJstDateTime(plan.computedAt)}{shown.demoClock && "（デモの基準日時）"}／在庫の最後の更新：{lastUpdate}</p>
          <p className="used-conditions">使った条件：{request.quantityKg}kg／{request.desiredDate}に受け取り／産地 {request.originPrefectures.join("・")}／予算 {request.budgetYen === null ? "上限なし" : yen(request.budgetYen)}／初めての農家 {request.allowFirstTime ? "含める" : "含めない"}／規格外 {request.allowIrregular ? "含める" : "含めない"}／品種 {request.allowMixedVarieties ? "まぜてよい" : "まぜない"}／規格 {request.allowMixedGrades ? "まぜてよい" : "まぜない"}</p>
        </details>
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
