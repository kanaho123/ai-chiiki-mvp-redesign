import { formatJstDateTime, jstTimeOf } from "../../lib/dates.js";
import { EXCLUSION_TEXT, headlineText, NOTICE_TEXT, rankingText, REASON_TEXT, STATUS_TEXT } from "../../lib/reasons.js";
import type { Suggestion } from "../../lib/suggest.js";
import { Icon } from "../../components/Icon";
import type { Freshness, Shown } from "./types";

// STEP 3：仕入れ案。結論 → まとめ → 農家別カード → 理由 → 使わなかった供給 の順に表示する。
// 数量・金額・状態・理由はすべてサーバーの通常ロジックの結果をそのまま表示する（AI は関与しない）。

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
  // 状態は色だけでなく、アイコンと言葉でも伝える。不足・確認待ちに成功アイコン・成功色は使わない
  const status = freshness === "stale"
    ? { icon: "x" as const, text: "無効：この仕入れ案は現在の情報ではありません" }
    : freshness === "checking"
      ? { icon: "refresh" as const, text: "最新の情報か確認中…" }
      : { icon: ok ? ("check" as const) : ("alert" as const), text: STATUS_TEXT[plan.status] };
  const ranking = rankingText(plan.rankingReason);
  const hasPlan = plan.allocations.length > 0;
  const short = plan.status === "NOT_MATCHED" && hasPlan && plan.shortageKg > 0;
  const lastUpdate = plan.supplySnapshot.length ? formatJstDateTime(plan.supplySnapshot.map((s) => s.updatedAt).sort().at(-1)!) : "—";
  const totalText = plan.totalYen === null ? "総額未確定" : `総額 ${yen(plan.totalYen)}`;
  // 不足・確認待ち・案なしのときは「条件を変更」が主な次の操作
  const editIsPrimary = freshness === "fresh" && plan.status !== "MATCHED";

  return (
    <section className="result" aria-live="polite" aria-labelledby="result-title">
      <h2 className="sr-only" id="result-title">仕入れ案</h2>

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
        {/* 1. 結論 */}
        <div className={`card hero summary ${tone}`}>
          <p className={`status ${tone}`}><Icon name={status.icon} />{status.text}</p>
          <div className="big-lines">
            {short ? (
              <>
                <p className="big-line"><span className="nowrap"><Num stale={stale}>{plan.fulfilledKg}<small>kg</small></Num>まで</span><span className="nowrap">提案できます</span></p>
                <p className="big-line sub short"><span className="nowrap">あと{plan.shortageKg}kg</span><span className="nowrap">不足しています</span></p>
              </>
            ) : hasPlan ? (
              <>
                <p className="big-line"><Num stale={stale}>{plan.fulfilledKg}<small>kg</small></Num></p>
                <p className="big-line sub"><Num stale={stale}>{totalText}</Num></p>
              </>
            ) : (
              <p className="big-line sub">この条件で組める案はありません</p>
            )}
          </div>
          <p className="headline">{freshness === "stale" ? "【無効】" : freshness === "checking" ? "【確認中】" : ""}{headlineText(plan)}</p>
          <div className="notice-chips" aria-label="この案の状態">
            <span className="chip chip-warn"><Icon name="info" size={16} />生産者への確認前</span>
            <span className="chip chip-warn"><Icon name="info" size={16} />在庫未確保</span>
          </div>
          <p className="status-detail">この仕入れ案は登録情報をもとにした検討用です。注文・予約・在庫確保ではありません。</p>
          <p className="computed-at">計算時点 {formatJstDateTime(plan.computedAt)}{shown.demoClock && "（デモ基準日時）"}の登録情報／供給の最終更新 {lastUpdate}</p>
        </div>

        {/* 2. まとめ */}
        {hasPlan && (
          <section className="card" aria-labelledby="summary-title">
            <h3 className="card-title" id="summary-title">仕入れ案のまとめ</h3>
            <dl className="summary-list price-rows">
              <dt>希望数量</dt><dd>{plan.requestedKg}kg</dd>
              <dt>提案数量</dt><dd><Num stale={stale}>{plan.fulfilledKg}kg</Num></dd>
              <dt>不足数量</dt><dd className={plan.shortageKg > 0 ? "short-value" : ""}>{plan.shortageKg > 0 ? `${plan.shortageKg}kg` : "なし"}</dd>
              <span className="sep" aria-hidden="true" />
              <dt>商品代<small>税込</small></dt><dd><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></dd>
              <dt>受渡費<small>1案につき1回</small></dt><dd>{plan.handoverFeeYen === null ? "未確認" : <Num stale={stale}>{yen(plan.handoverFeeYen)}</Num>}</dd>
              <dt>総額</dt><dd className="total">{plan.totalYen === null ? "総額未確定（確認が必要）" : <Num stale={stale}>{yen(plan.totalYen)}</Num>}</dd>
              {plan.budgetYen !== null && (
                <>
                  <dt>予算</dt>
                  <dd>{yen(plan.budgetYen)}{plan.budgetStatus === "UNKNOWN" ? "（総額未確定のため判定保留）" : "以内"}</dd>
                </>
              )}
              <span className="sep" aria-hidden="true" />
              {plan.slot && (
                <>
                  <dt>受渡日時</dt><dd>{formatJstDateTime(plan.slot.startAt)}〜{jstTimeOf(plan.slot.endAt)}</dd>
                  <dt>受渡場所</dt><dd>{plan.slot.placeName}（{plan.slot.label}）</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {ranking && !stale && <div className="alert ok" role="note"><Icon name="info" />{ranking}</div>}
        {plan.notices.map((n) => <div className="alert warn" key={n}><Icon name="alert" />{NOTICE_TEXT[n]}</div>)}

        {/* 3. 農家別カード */}
        {hasPlan && (
          <section className="card" aria-labelledby="alloc-title">
            <h3 className="card-title" id="alloc-title">農家別の内訳<span className="muted" style={{ fontSize: "1rem", fontWeight: 500 }}>（{plan.producerCount}農家）</span></h3>
            <ul className="farm-cards">
              {plan.allocations.map((a) => (
                <li key={a.supplyId} className="farm-card">
                  <div className="farm-card-top">
                    <span className="name">{a.producerName}</span>
                    <span className="farm-kg"><Num stale={stale}>{a.kg}<small>kg</small></Num></span>
                  </div>
                  <div className="chips">
                    <span className={`chip ${a.priorTrade ? "chip-prior" : "chip-first"}`}>{a.priorTrade ? "取引経験あり（店の申告）" : "初回"}</span>
                    {a.irregularReason && <span className="chip chip-warn">規格外：{a.irregularReason}</span>}
                    {!a.participationConfirmed && <span className="chip chip-need">受渡枠への参加確認が必要</span>}
                  </div>
                  <dl className="farm-meta">
                    <dt>単価</dt><dd>{a.priceYenPerKg.toLocaleString("ja-JP")}円/kg（{a.varietyName}）</dd>
                    <dt>商品代</dt><dd><Num stale={stale}>{yen(a.subtotalYen)}</Num></dd>
                    <dt>供給更新</dt><dd>{formatJstDateTime(a.updatedAt)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 4. 理由 */}
        {plan.reasonCodes.length > 0 && (
          <section className="card" aria-labelledby="reason-title">
            <h3 className="card-title" id="reason-title">理由</h3>
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

        {/* 5. 使わなかった供給（安い供給を使わない理由が分かるように） */}
        {plan.excluded.length > 0 && (
          <section className="card" aria-labelledby="excluded-title">
            <h3 className="card-title" id="excluded-title">今回は使わなかった供給</h3>
            <ul className="excluded-list">
              {plan.excluded.map((e) => (
                <li key={e.supplyId} className="excluded-item">
                  <span className="name">{e.producerName}</span>
                  <span className="muted">（{e.availableKg}kg・{e.priceYenPerKg.toLocaleString("ja-JP")}円/kg）</span>
                  <p className="why">{e.details.map((d) => EXCLUSION_TEXT[d]).join("、")}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {shown.suggestions.length > 0 && !stale && (
          <section className="card" aria-labelledby="sugg-title">
            <h3 className="card-title" id="sugg-title">条件を変更する場合の候補</h3>
            <p className="hint">選ぶと条件確認の画面に反映されます。勝手に条件を変えて計算することはありません。</p>
            <div className="chips">
              {shown.suggestions.map((s) => (
                <button key={s.type} type="button" className="secondary" onClick={() => onSuggestion(s)}>{s.label}</button>
              ))}
            </div>
          </section>
        )}

        <p className="used-conditions">
          使った条件：{request.quantityKg}kg／{request.desiredDate}受取／産地 {request.originPrefectures.join("・")}／予算 {request.budgetYen === null ? "上限なし" : yen(request.budgetYen)}
          ／初回{request.allowFirstTime ? "含める" : "含めない"}／規格外{request.allowIrregular ? "可" : "不可"}／品種混在{request.allowMixedVarieties ? "可" : "不可"}／規格混在{request.allowMixedGrades ? "可" : "不可"}
        </p>
      </div>

      {/* 次の行動は「再計算」と「条件を変更」だけ（注文・予約・送信はできない） */}
      <div className="next-actions">
        {editIsPrimary && <button type="button" className="primary large block" onClick={onEdit}>条件を変更</button>}
        {freshness !== "stale" && (
          <button type="button" className="secondary block" onClick={onRecalc} disabled={busy} aria-busy={busy}>
            {busy ? busyLabel : <><Icon name="refresh" />最新情報で再計算</>}
          </button>
        )}
        {!editIsPrimary && <button type="button" className="ghost block" onClick={onEdit}>条件を変更</button>}
      </div>
    </section>
  );
}
