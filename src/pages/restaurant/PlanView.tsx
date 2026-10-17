import { formatJstDateTime, jstTimeOf } from "../../lib/dates.js";
import { EXCLUSION_TEXT, headlineText, NOTICE_TEXT, rankingText, REASON_TEXT, STATUS_TEXT } from "../../lib/reasons.js";
import type { Suggestion } from "../../lib/suggest.js";
import { Icon } from "../../components/Icon";
import type { Freshness, Shown } from "./types";

// STEP 3：仕入れ案。大きな結論 → 受渡 → 農家別カード → レシート → この案になった理由 → 使わなかった供給。
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
  const tone = stale ? "stale" : ok ? "ok" : "warn";
  const ranking = rankingText(plan.rankingReason);
  const lastUpdate = plan.supplySnapshot.length ? formatJstDateTime(plan.supplySnapshot.map((s) => s.updatedAt).sort().at(-1)!) : "—";
  const lineup = plan.allocations.map((a) => `${a.producerName} ${a.kg}kg`).join(" ＋ ");
  const totalText = plan.totalYen === null ? "総額未確定（確認が必要）" : `総額 ${yen(plan.totalYen)}`;

  // 状態は色だけでなく、アイコンと言葉でも伝える。不足・確認待ちに成功アイコン・成功色は使わない
  const status = freshness === "stale" ? "無効：この仕入れ案は現在の情報ではありません"
    : freshness === "checking" ? "最新の情報か確認中…" : STATUS_TEXT[plan.status];
  const icon = stale ? (freshness === "stale" ? "x" : "refresh") : ok ? "check" : "alert";
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
        {/* 1. 結論 */}
        <div className={`verdict hero ${tone}`}>
          <span className="verdict-icon" aria-hidden="true"><Icon name={icon} size={34} strokeWidth={2.2} /></span>
          <p className="verdict-status status">{status}</p>
          <p className="verdict-title">{freshness === "stale" ? "【無効】" : freshness === "checking" ? "【確認中】" : ""}{title}</p>
          {sub && <p className="verdict-sub big-line">{sub}</p>}
          {hasPlan && <p className="verdict-sub farms-line"><Num stale={stale}>{lineup}</Num></p>}
          {hasPlan && <p className="verdict-total"><Num stale={stale}>{totalText}</Num></p>}
          {!ok && <p className="verdict-scope headline">{headlineText(plan)}</p>}
          <div className="chips" aria-label="この案の状態">
            <span className="chip chip-warn">生産者への確認前</span>
            <span className="chip chip-warn">在庫未確保</span>
          </div>
          <p className="verdict-note">登録情報をもとにした検討用の案です。注文・予約・在庫確保ではありません。</p>
        </div>

        {/* 2. 受渡 */}
        {hasPlan && plan.slot && (
          <p className="slot-line">
            <span><Icon name="calendar" size={18} />{formatJstDateTime(plan.slot.startAt)}〜{jstTimeOf(plan.slot.endAt)}</span>
            <span><Icon name="pin" size={18} />{plan.slot.placeName}（{plan.slot.label}）</span>
          </p>
        )}

        {/* 3. 仕入れ案（農家別カード：スマホ1列、十分な幅の PC のみ2列） */}
        {hasPlan && (
          <>
            <h3 className="section-title">仕入れ案<span className="muted small" style={{ fontWeight: 500 }}>（{plan.producerCount}農家）</span></h3>
            <ul className="farm-grid" aria-label="農家別の内訳">
              {plan.allocations.map((a) => (
                <li key={a.supplyId} className="farm farm-card">
                  <div className="farm-top farm-card-top">
                    <span className="farm-name name">{a.producerName}</span>
                    <span className="farm-kg"><Num stale={stale}>{a.kg}<small>kg</small></Num></span>
                  </div>
                  <div className="farm-price"><span>{a.priceYenPerKg.toLocaleString("ja-JP")}円/kg</span><b><Num stale={stale}>{yen(a.subtotalYen)}</Num></b></div>
                  <div className="chips">
                    <span className={`chip ${a.priorTrade ? "chip-prior" : "chip-first"}`}>{a.priorTrade ? "取引経験あり（店の申告）" : "初回"}</span>
                    {a.irregularReason && <span className="chip chip-warn">規格外：{a.irregularReason}</span>}
                    {!a.participationConfirmed && <span className="chip chip-need">受渡枠への参加確認が必要</span>}
                  </div>
                  <p className="farm-foot">{a.varietyName}・供給更新 {formatJstDateTime(a.updatedAt)}</p>
                </li>
              ))}
            </ul>

            {/* 4. レシート */}
            <div className="receipt" aria-label="金額">
              <dl className="receipt-rows summary-list price-rows">
                <dt>希望 {plan.requestedKg}kg／提案</dt><dd><Num stale={stale}>{plan.fulfilledKg}kg</Num></dd>
                {plan.shortageKg > 0 && (<><dt>不足</dt><dd className="short">{plan.shortageKg}kg</dd></>)}
                <span className="rule" aria-hidden="true" />
                <dt>商品代<small>税込</small></dt><dd><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></dd>
                <dt>受渡費<small>1案につき1回</small></dt><dd>{plan.handoverFeeYen === null ? "未確認" : <Num stale={stale}>{yen(plan.handoverFeeYen)}</Num>}</dd>
                <span className="rule" aria-hidden="true" />
                <dt>総額</dt><dd className="total">{plan.totalYen === null ? "総額未確定（確認が必要）" : <Num stale={stale}>{yen(plan.totalYen)}</Num>}</dd>
                {plan.budgetYen !== null && (<><dt>予算</dt><dd>{yen(plan.budgetYen)}{plan.budgetStatus === "UNKNOWN" ? "（判定保留）" : "以内"}</dd></>)}
              </dl>
            </div>
          </>
        )}

        {/* 5. この案になった理由 */}
        {why.length > 0 && (
          <>
            <h3 className="section-title">{hasPlan ? "この案になった理由" : "理由"}</h3>
            <div className="card">
              <ul className="reasons">
                {why.map((w) => (
                  <li key={w.text} className={w.caution ? "caution" : ""}><Icon name={w.caution ? "alert" : "check"} size={18} />{w.text}</li>
                ))}
              </ul>
            </div>
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
            <div className="chips">
              {shown.suggestions.map((s) => <button key={s.type} type="button" className="example-chip" onClick={() => onSuggestion(s)}>{s.label}</button>)}
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
      <div className="bottom-bar next-actions">
        <div className="bottom-bar-inner">
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
        </div>
      </div>
    </section>
  );
}
