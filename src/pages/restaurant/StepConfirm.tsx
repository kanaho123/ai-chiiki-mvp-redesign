import { formatDateJa, formatJstDateTime, jstDate, jstDateOf, jstTimeOf } from "../../lib/dates.js";
import { missingFields, type RequestForm, type YesNo } from "../../lib/request-form.js";
import { RESOLVE_NOTICE_TEXT, type DraftField } from "../../lib/resolve.js";
import { Icon } from "../../components/Icon";
import type { CatalogData, ExtractResult } from "./types";

// STEP 2：条件の確認・修正。AI の読み取り結果はここで必ず利用者が確認し、未確定の項目は利用者が選ぶ。
// 送るのはこのフォームの値だけ（AI の出力をそのまま計算に使わない）。

const FIELD_LABEL: Record<DraftField, string> = {
  itemId: "品目", varietyId: "品種", quantityKg: "数量", desiredDate: "受け取りたい日", budget: "予算", originPrefectures: "産地",
  slotId: "受渡枠", allowFirstTime: "初回の農家", allowIrregular: "規格外", allowMixedVarieties: "品種の混在", allowMixedGrades: "規格の混在",
  preferredProducerId: "優先する取引先",
};

const slotText = (s: { label: string; placeName: string; startAt: string; endAt: string }) =>
  `${s.label}：${formatJstDateTime(s.startAt)}〜${jstTimeOf(s.endAt)}／${s.placeName}`;

function YesNoChoice({ name, value, onChange, yes, no }: {
  name: string; value: YesNo; onChange: (v: YesNo) => void; yes: [string, string]; no: [string, string];
}) {
  return (
    <div className="choice" role="radiogroup" aria-labelledby={`${name}-title`} aria-required="true">
      {([["yes", yes], ["no", no]] as const).map(([v, [label, sub]]) => (
        <label key={v}>
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
          <span>{label}<small>{sub}</small></span>
        </label>
      ))}
    </div>
  );
}

export function StepConfirm({ form, setForm, catalog, extraction, sourceText, aiFields, busy, error, notice, onSubmit, onBack }: {
  form: RequestForm; setForm: (f: RequestForm) => void; catalog: CatalogData; extraction: ExtractResult | null; sourceText: string;
  aiFields: DraftField[]; busy: boolean; error: string | null; notice: string | null; onSubmit: () => void; onBack: () => void;
}) {
  const set = <K extends keyof RequestForm>(k: K, v: RequestForm[K]) => setForm({ ...form, [k]: v });
  const item = catalog.items.find((i) => i.id === form.itemId);
  const today = jstDate(0, new Date(catalog.now));
  const missing = missingFields(form);
  const prefs = [...new Set([...catalog.nearbyPrefectures, ...form.originPrefectures])];
  const dateCands = extraction?.candidateMatches.desiredDate ?? [];
  const slotCands = new Set((extraction?.candidateMatches.slotId ?? []).map((c) => c.id));
  const slots = catalog.slots.filter((s) => !form.desiredDate || jstDateOf(s.startAt) === form.desiredDate);
  const required = extraction?.extracted.producerRequired === true;

  /** 項目ごとの目印：未確定は「確認してください」、AI が読み取った値は「AIが読み取り」（どちらも変更できる） */
  const Badge = ({ f }: { f: DraftField }) =>
    missing.includes(f) ? <span className="chip chip-need">確認してください</span>
      : aiFields.includes(f) ? <span className="chip chip-ai">AIが読み取り</span> : null;

  return (
    <form className="page" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} aria-labelledby="step2-title">
      <section className="card">
        <h2 className="card-title" id="step2-title">条件を確認してください</h2>
        {extraction ? (
          <div className="alert info" role="note">
            <Icon name="info" />
            <div>
              AIが文章から読み取った条件の候補です。<b>内容を確認・修正してから</b>計算します。農家の組み合わせ・数量・金額は、AIではなく登録データから通常の計算で決まります。
              <p className="source-text">入力した文章：「{sourceText}」</p>
            </div>
          </div>
        ) : (
          <p className="hint">項目を選んで条件を指定します。{sourceText && <>入力した文章：「{sourceText}」</>}</p>
        )}
        {extraction?.notices.map((n) => <div className="alert warn" key={n} role="status"><Icon name="alert" />{RESOLVE_NOTICE_TEXT[n]}</div>)}
        {required && <div className="alert warn" role="status"><Icon name="alert" />農家の必須指定は今回の対応範囲外です。優先として扱う場合は「優先する取引先」で選んでください。</div>}
      </section>

      <section className="card group" aria-labelledby="g-basic">
        <h3 className="group-title" id="g-basic">基本条件</h3>
        <div className="row">
          <label className="field">
            <span className="label">品目 <Badge f="itemId" /></span>
            <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value, varietyId: "" })} aria-required="true">
              <option value="">選択してください</option>
              {catalog.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="label">数量 <Badge f="quantityKg" /></span>
            <span className="with-unit">
              <input type="number" inputMode="numeric" min={1} max={100} step={1} value={form.quantityKg} onChange={(e) => set("quantityKg", e.target.value)} placeholder="例：10" aria-required="true" />
              <em>kg</em>
            </span>
          </label>
        </div>
        <label className="field">
          <span className="label">品種 <Badge f="varietyId" /></span>
          <select value={form.varietyId} onChange={(e) => set("varietyId", e.target.value)}>
            <option value="">指定なし（同じ品種どうしで組みます）</option>
            {item?.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <span className="hint">整数kg・1〜100kgに対応しています。</span>
        </label>
        <fieldset className="field">
          <legend className="label">産地（どこで採れたか。受取場所とは別） <Badge f="originPrefectures" /></legend>
          <div className="choice">
            {prefs.map((p) => (
              <label key={p}>
                <input type="checkbox" checked={form.originPrefectures.includes(p)}
                  onChange={(e) => set("originPrefectures", e.target.checked ? [...form.originPrefectures, p] : form.originPrefectures.filter((x) => x !== p))} />
                <span>{p}産</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <span className="label" id="budget-title">予算（税込・受渡費込みの総額） <Badge f="budget" /></span>
          <div className="choice" role="radiogroup" aria-labelledby="budget-title" aria-required="true">
            <label>
              <input type="radio" name="budget" checked={form.budgetMode === "limit"} onChange={() => set("budgetMode", "limit")} />
              <span>金額を指定<small>総額がこの金額以内の案</small></span>
            </label>
            <label>
              <input type="radio" name="budget" checked={form.budgetMode === "none"} onChange={() => set("budgetMode", "none")} />
              <span>上限なし<small>予算で絞らない</small></span>
            </label>
          </div>
          {form.budgetMode === "limit" && (
            <span className="with-unit" style={{ marginTop: 8 }}>
              <input type="number" inputMode="numeric" min={1} step={1} value={form.budgetYen} onChange={(e) => set("budgetYen", e.target.value)} placeholder="例：8000" aria-label="予算（円）" />
              <em>円</em>
            </span>
          )}
        </div>
      </section>

      <section className="card group" aria-labelledby="g-handover">
        <h3 className="group-title" id="g-handover">受渡条件</h3>
        <label className="field">
          <span className="label">受け取りたい日 <Badge f="desiredDate" /></span>
          <input type="date" min={today} value={form.desiredDate} onChange={(e) => setForm({ ...form, desiredDate: e.target.value, slotId: "" })} aria-required="true" />
          {form.desiredDate && <span className="hint">{formatDateJa(form.desiredDate)}{catalog.demoClock && `（デモ基準日時 ${formatJstDateTime(catalog.now)} から計算）`}</span>}
        </label>
        {dateCands.length > 1 && (
          <div className="date-cands" role="group" aria-label="日付の候補">
            {dateCands.map((c) => (
              <button key={c.id} type="button" className={form.desiredDate === c.id ? "secondary" : "ghost"} onClick={() => setForm({ ...form, desiredDate: c.id, slotId: "" })}>{c.label}</button>
            ))}
          </div>
        )}
        <fieldset className="field">
          <legend className="label">受渡枠（受取場所・時間） <Badge f="slotId" /></legend>
          {slots.length === 0 ? (
            <p className="muted">{form.desiredDate ? "この日の受渡枠は登録されていません。日付を確認してください。" : "先に受け取りたい日を選んでください。"}</p>
          ) : (
            <div className="choice choice-stack">
              {slots.map((s) => (
                <label key={s.id}>
                  <input type="radio" name="slot" checked={form.slotId === s.id} onChange={() => set("slotId", s.id)} />
                  <span>
                    {slotText(s)}
                    <small>受渡費 {s.feeConfirmed ? `${s.feeYen.toLocaleString("ja-JP")}円（1案に1回）` : "未確認"}・最大{s.maxKg}kg・確認締切 {formatJstDateTime(s.confirmDeadlineAt)}{slotCands.has(s.id) && extraction?.extracted.handoverText && "・文章の受取場所に合う候補"}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          <span className="hint">同じ受渡枠の供給だけを組み合わせます。受取場所の条件で、産地とは別です。</span>
        </fieldset>
      </section>

      <section className="card group" aria-labelledby="g-allow">
        <h3 className="group-title" id="g-allow">許容条件</h3>
        <div className="field">
          <span className="label" id="q-first-title">初回の農家 <Badge f="allowFirstTime" /></span>
          <YesNoChoice name="q-first" value={form.allowFirstTime} onChange={(v) => set("allowFirstTime", v)}
            yes={["含める", "取引経験のない農家も候補にする"]} no={["含めない", "取引経験のある農家だけ"]} />
          <span className="hint">取引経験は店の申告情報です。品質や信用の保証ではありません。</span>
        </div>
        <div className="field">
          <span className="label" id="q-irr-title">規格外（形の不揃い等） <Badge f="allowIrregular" /></span>
          <YesNoChoice name="q-irr" value={form.allowIrregular} onChange={(v) => set("allowIrregular", v)}
            yes={["許可する", "規格外品も候補にする"]} no={["許可しない", "通常品だけ"]} />
        </div>
        <div className="field">
          <span className="label" id="q-mixv-title">異なる品種の混在 <Badge f="allowMixedVarieties" /></span>
          <YesNoChoice name="q-mixv" value={form.allowMixedVarieties} onChange={(v) => set("allowMixedVarieties", v)}
            yes={["混ぜてよい", "品質が等しいとは限りません"]} no={["混ぜない", "同じ品種どうしで組む"]} />
        </div>
        <div className="field">
          <span className="label" id="q-mixg-title">通常品と規格外品の混在 <Badge f="allowMixedGrades" /></span>
          <YesNoChoice name="q-mixg" value={form.allowMixedGrades} onChange={(v) => set("allowMixedGrades", v)}
            yes={["混ぜてよい", "規格外を許可した場合のみ"]} no={["混ぜない", "同じ規格どうしで組む"]} />
        </div>
        <label className="field">
          <span className="label">優先する取引先<span className="opt">任意</span> <Badge f="preferredProducerId" /></span>
          <select value={form.preferredProducerId} onChange={(e) => set("preferredProducerId", e.target.value)}>
            <option value="">指定なし</option>
            {catalog.priorTradeProducers.map((p) => <option key={p.id} value={p.id}>{p.name}（取引経験あり）</option>)}
          </select>
          <span className="hint">取引経験のある農家から選べます。優先は必須条件ではなく、仕入れ先の数が少ない案を先に選びます。</span>
        </label>
      </section>

      <div className="sticky-submit">
        {notice && <div className="alert info" role="status"><Icon name="info" />{notice}</div>}
        {missing.length > 0 && (
          <div className="alert warn" role="status"><Icon name="alert" />まだ選んでいない項目：{missing.map((f) => FIELD_LABEL[f]).join("・")}</div>
        )}
        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
        <button type="submit" className="primary large block" disabled={busy || missing.length > 0} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />計算中…</> : "この条件で仕入れ案を見る"}
        </button>
      </div>
      <button type="button" className="ghost block" onClick={onBack}>文章の入力に戻る</button>
    </form>
  );
}
