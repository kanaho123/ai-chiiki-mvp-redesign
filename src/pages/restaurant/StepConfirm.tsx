import { formatDateJa, formatJstDateTime, jstDate, jstDateOf, jstTimeOf } from "../../lib/dates.js";
import { missingFields, type RequestForm, type YesNo } from "../../lib/request-form.js";
import type { DraftField } from "../../lib/resolve.js";
import { BottomBar } from "../../components/BottomBar";
import { Icon } from "../../components/Icon";
import { plainResolveNotice } from "./plain-text";
import type { CatalogData, ExtractResult } from "./types";

// STEP 2：「この条件で合っていますか？」。AI の読み取り結果は必ず利用者が確認し、未確定の項目は利用者が選ぶ。
// 送るのはこの画面の値だけ（AI の出力をそのまま計算に使わない）。

const FIELD_LABEL: Record<DraftField, string> = {
  itemId: "品目", varietyId: "品種", quantityKg: "数量", desiredDate: "受け取りたい日", budget: "予算", originPrefectures: "産地",
  slotId: "受け取り時間と場所", allowFirstTime: "初めての農家", allowIrregular: "規格外", allowMixedVarieties: "品種をまぜるか", allowMixedGrades: "規格をまぜるか",
  preferredProducerId: "優先したい農家",
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

  /** 項目ごとの目印：文章から読み取れた値は「読み取り済み」、自分で決める必要があるものは「選んでください」（どちらも変更できる） */
  const fieldsOf = (f: DraftField | DraftField[]) => (Array.isArray(f) ? f : [f]);
  const needs = (f: DraftField | DraftField[]) => fieldsOf(f).some((x) => missing.includes(x));
  const rowClass = (f: DraftField | DraftField[]) => (needs(f) ? "item-row need" : "item-row");
  const Mark = ({ f }: { f: DraftField | DraftField[] }) =>
    needs(f) ? <span className="mark mark-need">選んでください</span>
      : fieldsOf(f).some((x) => aiFields.includes(x)) ? <span className="mark mark-ai">✓ 読み取り済み</span> : null;
  const Head = ({ label, f, id }: { label: string; f: DraftField | DraftField[]; id?: string }) => (
    <div className="item-head">
      <span className="item-label" id={id}>{label}</span>
      <Mark f={f} />
    </div>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} aria-labelledby="step2-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <h1 className="display" id="step2-title">この内容で合っていますか？</h1>
      <p className="intro">{extraction ? "文章から読み取った内容です。違うところは直してください。" : "必要な項目を選んでください。"}</p>
      {sourceText && <p className="source-quote"><span>入力した文章</span>{sourceText}</p>}
      {extraction?.notices.map((n) => <div className="alert warn" key={n} role="status"><Icon name="alert" />{plainResolveNotice(n)}</div>)}
      {required && <div className="alert warn" role="status"><Icon name="alert" />農家を必ず指定することは、今回はできません。優先したい場合は「優先したい農家」で選んでください。</div>}

      {/* 基本条件 */}
      <section className="card group-card" aria-labelledby="g-basic">
        <h3 id="g-basic">基本の条件</h3>
        <div className={rowClass(["itemId", "quantityKg", "varietyId"])}>
          <Head label="品目と数量" f={["itemId", "quantityKg", "varietyId"]} />
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
        <div className={rowClass("originPrefectures")}>
          <Head label="産地" f="originPrefectures" id="lbl-origin" />
          <div className="pick" role="group" aria-labelledby="lbl-origin">
            {prefs.map((p) => (
              <label key={p}>
                <input type="checkbox" checked={form.originPrefectures.includes(p)}
                  onChange={(e) => set("originPrefectures", e.target.checked ? [...form.originPrefectures, p] : form.originPrefectures.filter((x) => x !== p))} />
                {p}産
              </label>
            ))}
          </div>
          <span className="item-help">どこで採れた野菜か（受け取る場所とは別です）。</span>
        </div>
        <div className={rowClass("budget")}>
          <Head label="予算（税込・受け渡し費用を含めた合計）" f="budget" id="lbl-budget" />
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
        <h3 id="g-handover">受け取り</h3>
        <div className={rowClass("desiredDate")}>
          <Head label="受け取りたい日" f="desiredDate" />
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
        <div className={rowClass("slotId")}>
          <Head label="受け取り時間と場所" f="slotId" id="lbl-slot" />
          {slots.length === 0 ? (
            <p className="muted">{form.desiredDate ? "この日に受け取れる時間と場所は登録されていません。日付を確認してください。" : "先に受け取りたい日を選んでください。"}</p>
          ) : (
            <div className="option-cards" role="radiogroup" aria-labelledby="lbl-slot">
              {slots.map((s) => (
                <label key={s.id} className="option-card">
                  <input type="radio" name="slot" checked={form.slotId === s.id} onChange={() => set("slotId", s.id)} />
                  <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
                  <span>
                    <b>{s.placeName}（{s.label}）</b>
                    <small>{formatJstDateTime(s.startAt)}〜{jstTimeOf(s.endAt)}・受け渡し費用 {s.feeConfirmed ? `${s.feeYen.toLocaleString("ja-JP")}円（1回分）` : "未確認"}・重さの上限 {s.maxKg}kg</small>
                    <small>確認の締切 {formatJstDateTime(s.confirmDeadlineAt)}{slotCands.has(s.id) && extraction?.extracted.handoverText && "・文章の受け取り場所に合う候補"}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          <span className="item-help">同じ時間・場所で受け取れる農家だけを組み合わせます。</span>
        </div>
      </section>

      {/* 許容条件 */}
      <section className="card group-card" aria-labelledby="g-allow">
        <h3 id="g-allow">含めてよいもの</h3>
        <div className={rowClass("allowFirstTime")}>
          <Head label="初めて取引する農家" f="allowFirstTime" id="lbl-first" />
          <Seg name="q-first" value={form.allowFirstTime} onChange={(v) => set("allowFirstTime", v)} no="含めない" yes="含める" labelId="lbl-first" />
          <span className="item-help">取引経験は、お店が申告した情報です。品質や信用を保証するものではありません。</span>
        </div>
        <div className={rowClass("allowIrregular")}>
          <Head label="規格外（形が不ぞろいなど）" f="allowIrregular" id="lbl-irr" />
          <Seg name="q-irr" value={form.allowIrregular} onChange={(v) => set("allowIrregular", v)} no="含めない" yes="含める" labelId="lbl-irr" />
        </div>
        <div className={rowClass("allowMixedVarieties")}>
          <Head label="違う品種をまぜる" f="allowMixedVarieties" id="lbl-mixv" />
          <Seg name="q-mixv" value={form.allowMixedVarieties} onChange={(v) => set("allowMixedVarieties", v)} no="まぜない" yes="まぜてよい" labelId="lbl-mixv" />
        </div>
        <div className={rowClass("allowMixedGrades")}>
          <Head label="通常品と規格外品をまぜる" f="allowMixedGrades" id="lbl-mixg" />
          <Seg name="q-mixg" value={form.allowMixedGrades} onChange={(v) => set("allowMixedGrades", v)} no="まぜない" yes="まぜてよい" labelId="lbl-mixg" />
        </div>
        <div className={rowClass("preferredProducerId")}>
          <Head label="優先したい農家（なくてもよい）" f="preferredProducerId" />
          <select value={form.preferredProducerId} onChange={(e) => set("preferredProducerId", e.target.value)} aria-label="優先したい農家">
            <option value="">指定なし</option>
            {catalog.priorTradeProducers.map((p) => <option key={p.id} value={p.id}>{p.name}（取引経験あり）</option>)}
          </select>
          <span className="item-help">優先は「必ず」ではありません。仕入れ先の数が少ない案を先に選びます。</span>
        </div>
      </section>

      {notice && <div className="alert info" role="status"><Icon name="info" />{notice}</div>}
      {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
      <button type="button" className="btn-secondary btn-block" onClick={onBack}>文章の入力に戻る</button>

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
