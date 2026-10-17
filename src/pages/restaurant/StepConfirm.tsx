import { formatDateJa, formatJstDateTime, jstDate, jstDateOf, jstTimeOf } from "../../lib/dates.js";
import { missingFields, type RequestForm, type YesNo } from "../../lib/request-form.js";
import { RESOLVE_NOTICE_TEXT, type DraftField } from "../../lib/resolve.js";
import { BottomBar } from "../../components/BottomBar";
import { Icon, type IconName } from "../../components/Icon";
import type { CatalogData, ExtractResult } from "./types";

// STEP 2：「この条件で合っていますか？」。AI の読み取り結果は必ず利用者が確認し、未確定の項目は利用者が選ぶ。
// 送るのはこの画面の値だけ（AI の出力をそのまま計算に使わない）。

const FIELD_LABEL: Record<DraftField, string> = {
  itemId: "品目", varietyId: "品種", quantityKg: "数量", desiredDate: "受け取りたい日", budget: "予算", originPrefectures: "産地",
  slotId: "受渡枠", allowFirstTime: "初回の農家", allowIrregular: "規格外", allowMixedVarieties: "品種の混在", allowMixedGrades: "規格の混在",
  preferredProducerId: "優先する取引先",
};

function Seg({ name, value, onChange, yes, no, labelId }: { name: string; value: YesNo; onChange: (v: YesNo) => void; yes: string; no: string; labelId: string }) {
  return (
    <div className="seg" role="radiogroup" aria-labelledby={labelId}>
      {([["no", no], ["yes", yes]] as const).map(([v, label]) => (
        <label key={v}><input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />{label}</label>
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

  /** 項目ごとの目印：AI が読み取った値は淡い緑、人が決める必要があるものはオレンジ（どちらも変更できる） */
  const Badge = ({ f }: { f: DraftField | DraftField[] }) => {
    const fs = Array.isArray(f) ? f : [f];
    return fs.some((x) => missing.includes(x)) ? <span className="chip chip-need">確認してください</span>
      : fs.some((x) => aiFields.includes(x)) ? <span className="chip chip-ai">AIが読み取り</span> : null;
  };
  const Head = ({ icon, label, f, id }: { icon: IconName; label: string; f: DraftField | DraftField[]; id?: string }) => (
    <div className="item-head">
      <span className="item-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <span className="item-label" id={id}>{label}</span>
      <Badge f={f} />
    </div>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} aria-labelledby="step2-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <div className="title-block">
        <p className="eyebrow">{extraction ? "AIが読み取った条件" : "項目を選んで入力"}</p>
        <h1 className="display" id="step2-title"><span className="nowrap">この条件で</span><span className="nowrap">合っていますか？</span></h1>
        {extraction
          ? <p className="lede">数量・価格・受渡条件は、確定後に登録情報から計算します。どの項目も変更できます。</p>
          : <p className="lede">必要な項目を選んでください。</p>}
      </div>
      {sourceText && <p className="source-quote">「{sourceText}」</p>}
      {extraction?.notices.map((n) => <div className="alert warn" key={n} role="status"><Icon name="alert" />{RESOLVE_NOTICE_TEXT[n]}</div>)}
      {required && <div className="alert warn" role="status"><Icon name="alert" />農家の必須指定は今回の対応範囲外です。優先として扱う場合は「優先する取引先」で選んでください。</div>}

      {/* 基本条件 */}
      <section className="card group-card" aria-labelledby="g-basic">
        <h3 id="g-basic">基本条件</h3>
        <div className="item-row">
          <Head icon="basket" label="品目と数量" f={["itemId", "quantityKg", "varietyId"]} />
          <div className="row2">
            <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value, varietyId: "" })} aria-label="品目" aria-required="true">
              <option value="">品目を選ぶ</option>
              {catalog.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <span className="with-unit">
              <input type="number" inputMode="numeric" min={1} max={100} step={1} value={form.quantityKg} onChange={(e) => set("quantityKg", e.target.value)} placeholder="10" aria-label="数量（kg）" aria-required="true" />
              <em>kg</em>
            </span>
          </div>
          {item && item.varieties.length > 1 && (
            <select value={form.varietyId} onChange={(e) => set("varietyId", e.target.value)} aria-label="品種">
              <option value="">品種の指定なし（同じ品種どうしで組みます）</option>
              {item.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </div>
        <div className="item-row">
          <Head icon="pin" label="産地" f="originPrefectures" id="lbl-origin" />
          <div className="pick" role="group" aria-labelledby="lbl-origin">
            {prefs.map((p) => (
              <label key={p}>
                <input type="checkbox" checked={form.originPrefectures.includes(p)}
                  onChange={(e) => set("originPrefectures", e.target.checked ? [...form.originPrefectures, p] : form.originPrefectures.filter((x) => x !== p))} />
                {p}産
              </label>
            ))}
          </div>
          <span className="item-help">どこで採れたか。受取場所とは別の条件です。</span>
        </div>
        <div className="item-row">
          <Head icon="yen" label="予算（税込・受渡費込みの総額）" f="budget" id="lbl-budget" />
          <div className="seg" role="radiogroup" aria-labelledby="lbl-budget">
            <label><input type="radio" name="budget" checked={form.budgetMode === "limit"} onChange={() => set("budgetMode", "limit")} />金額を指定</label>
            <label><input type="radio" name="budget" checked={form.budgetMode === "none"} onChange={() => set("budgetMode", "none")} />上限なし</label>
          </div>
          {form.budgetMode === "limit" && (
            <span className="with-unit">
              <input type="number" inputMode="numeric" min={1} step={1} value={form.budgetYen} onChange={(e) => set("budgetYen", e.target.value)} placeholder="8000" aria-label="予算（円）" />
              <em>円まで</em>
            </span>
          )}
        </div>
      </section>

      {/* 受渡条件 */}
      <section className="card group-card" aria-labelledby="g-handover">
        <h3 id="g-handover">受渡条件</h3>
        <div className="item-row">
          <Head icon="calendar" label="受け取りたい日" f="desiredDate" />
          <input type="date" min={today} value={form.desiredDate} onChange={(e) => setForm({ ...form, desiredDate: e.target.value, slotId: "" })} aria-label="受け取りたい日" aria-required="true" />
          {dateCands.length > 1 && (
            <div className="date-cands" role="group" aria-label="日付の候補">
              {dateCands.map((c) => (
                <button key={c.id} type="button" className={form.desiredDate === c.id ? "btn-secondary" : "btn-quiet"} onClick={() => setForm({ ...form, desiredDate: c.id, slotId: "" })}>{c.label}</button>
              ))}
            </div>
          )}
          {form.desiredDate && <span className="item-help">{formatDateJa(form.desiredDate)}{catalog.demoClock && `（デモ基準日時 ${formatJstDateTime(catalog.now)} から計算）`}</span>}
        </div>
        <div className="item-row">
          <Head icon="truck" label="受渡枠（受取場所・時間）" f="slotId" id="lbl-slot" />
          {slots.length === 0 ? (
            <p className="muted">{form.desiredDate ? "この日の受渡枠は登録されていません。日付を確認してください。" : "先に受け取りたい日を選んでください。"}</p>
          ) : (
            <div className="option-cards" role="radiogroup" aria-labelledby="lbl-slot">
              {slots.map((s) => (
                <label key={s.id} className="option-card">
                  <input type="radio" name="slot" checked={form.slotId === s.id} onChange={() => set("slotId", s.id)} />
                  <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
                  <span>
                    <b>{s.placeName}（{s.label}）</b>
                    <small>{formatJstDateTime(s.startAt)}〜{jstTimeOf(s.endAt)}・受渡費 {s.feeConfirmed ? `${s.feeYen.toLocaleString("ja-JP")}円（1案に1回）` : "未確認"}・最大{s.maxKg}kg</small>
                    <small>確認締切 {formatJstDateTime(s.confirmDeadlineAt)}{slotCands.has(s.id) && extraction?.extracted.handoverText && "・文章の受取場所に合う候補"}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          <span className="item-help">同じ受渡枠の供給だけを組み合わせます。</span>
        </div>
      </section>

      {/* 許容条件 */}
      <section className="card group-card" aria-labelledby="g-allow">
        <h3 id="g-allow">許容条件</h3>
        <div className="item-row">
          <Head icon="sprout" label="初回の農家" f="allowFirstTime" id="lbl-first" />
          <Seg name="q-first" value={form.allowFirstTime} onChange={(v) => set("allowFirstTime", v)} no="含めない" yes="含める" labelId="lbl-first" />
          <span className="item-help">取引経験は店の申告情報です。品質や信用の保証ではありません。</span>
        </div>
        <div className="item-row">
          <Head icon="leaf" label="規格外（形の不揃い等）" f="allowIrregular" id="lbl-irr" />
          <Seg name="q-irr" value={form.allowIrregular} onChange={(v) => set("allowIrregular", v)} no="許可しない" yes="許可する" labelId="lbl-irr" />
        </div>
        <div className="item-row">
          <Head icon="basket" label="異なる品種の混在" f="allowMixedVarieties" id="lbl-mixv" />
          <Seg name="q-mixv" value={form.allowMixedVarieties} onChange={(v) => set("allowMixedVarieties", v)} no="混ぜない" yes="混ぜてよい" labelId="lbl-mixv" />
        </div>
        <div className="item-row">
          <Head icon="leaf" label="通常品と規格外品の混在" f="allowMixedGrades" id="lbl-mixg" />
          <Seg name="q-mixg" value={form.allowMixedGrades} onChange={(v) => set("allowMixedGrades", v)} no="混ぜない" yes="混ぜてよい" labelId="lbl-mixg" />
        </div>
        <div className="item-row">
          <Head icon="store" label="優先する取引先（任意）" f="preferredProducerId" />
          <select value={form.preferredProducerId} onChange={(e) => set("preferredProducerId", e.target.value)} aria-label="優先する取引先">
            <option value="">指定なし</option>
            {catalog.priorTradeProducers.map((p) => <option key={p.id} value={p.id}>{p.name}（取引経験あり）</option>)}
          </select>
          <span className="item-help">優先は必須条件ではありません。仕入れ先の数が少ない案を先に選びます。</span>
        </div>
      </section>

      {notice && <div className="alert info" role="status"><Icon name="info" />{notice}</div>}
      {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
      <button type="button" className="btn-link" onClick={onBack}>文章の入力に戻る</button>

      <BottomBar>
        {missing.length > 0 && (
          <p className="bottom-note" role="status" title={missing.map((f) => FIELD_LABEL[f]).join("・")}>
            あと{missing.length}項目を選んでください<span className="sr-only">：{missing.map((f) => FIELD_LABEL[f]).join("・")}</span>
          </p>
        )}
        <button type="submit" className="btn-primary btn-block" disabled={busy || missing.length > 0} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />計算中…</> : <>この条件で仕入れ案を見る<Icon name="arrowRight" /></>}
        </button>
      </BottomBar>
    </form>
  );
}
