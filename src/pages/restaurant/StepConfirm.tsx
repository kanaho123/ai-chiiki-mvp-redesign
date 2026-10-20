import { useState } from "react";
import { formatDateJa, jstDate, jstDateOf, jstTimeOf, formatJstDateTime } from "../../lib/dates.js";
import { findItemByName, ITEM_NAME_MAX } from "../../lib/items.js";
import { missingFields, type RequestForm, type YesNo } from "../../lib/request-form.js";
import type { DraftField } from "../../lib/resolve.js";
import { BottomBar } from "../../components/BottomBar";
import { Icon, type IconName } from "../../components/Icon";
import { useSession } from "../../routes/session";
import { plainResolveNotice } from "./plain-text";
import { NO_LISTING } from "./WishList";
import type { CatalogData, ExtractResult } from "./types";

// STEP 2：「この内容で合っていますか？」。AI の読み取り結果は必ず利用者が確認し、未確定の項目は利用者が選ぶ。
// 送るのはこの画面の値だけ（AI の出力をそのまま計算に使わない）。
// 表示：画面を開いた時点で未選択の項目は「選んでください」に入力欄ごと並べ、決まっている項目はタイル（押すとその場で修正）にする。

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

type Field = { key: string; label: string; icon: IconName; f: DraftField[]; value: string; wide?: boolean; editor: () => React.ReactNode };

export function StepConfirm({ form, setForm, catalog, extraction, sourceText, aiFields, busy, error, notice, onSubmit, onBack }: {
  form: RequestForm; setForm: (f: RequestForm) => void; catalog: CatalogData; extraction: ExtractResult | null; sourceText: string;
  aiFields: DraftField[]; busy: boolean; error: string | null; notice: string | null; onSubmit: () => void; onBack: () => void;
}) {
  const set = <K extends keyof RequestForm>(k: K, v: RequestForm[K]) => setForm({ ...form, [k]: v });
  const item = catalog.items.find((i) => i.id === form.itemId);
  const today = jstDate(0, new Date(catalog.now));
  // 一般向けの環境だけ、受け取り場所は「おまかせ」にできる（デモ用の環境は従来どおり選ぶ）
  const autoSlot = useSession().appMode === "general";
  const missing = missingFields(form, { autoSlot });
  const prefs = [...new Set([...catalog.nearbyPrefectures, ...form.originPrefectures])];
  const dateCands = extraction?.candidateMatches.desiredDate ?? [];
  const slotCands = new Set((extraction?.candidateMatches.slotId ?? []).map((c) => c.id));
  const slots = catalog.slots.filter((s) => !form.desiredDate || jstDateOf(s.startAt) === form.desiredDate);
  const slot = catalog.slots.find((s) => s.id === form.slotId);
  const required = extraction?.extracted.producerRequired === true;
  const yn = (v: YesNo, no: string, yes: string) => (v === "yes" ? yes : v === "no" ? no : "");
  // 一般向けの環境：品目は候補つきの文字入力。登録済みの品目（表記の違いも同じ品目）だけを選べ、ここから品目は作らない
  const [itemText, setItemText] = useState(item?.name ?? "");
  const typedItem = itemText.trim() ? findItemByName(itemText, catalog.items) : null;
  const onItemText = (v: string) => {
    setItemText(v);
    const hit = v.trim() ? findItemByName(v, catalog.items) : null;
    if ((hit?.id ?? "") !== form.itemId) setForm({ ...form, itemId: hit?.id ?? "", varietyId: "" });
  };

  const fields: Field[] = [
    {
      key: "item", label: "品目", icon: "basket", f: ["itemId", "varietyId"],
      value: item ? `${item.name}${form.varietyId ? `（${item.varieties.find((v) => v.id === form.varietyId)?.name ?? ""}）` : ""}` : "",
      editor: () => (
        <>
          {autoSlot ? (
            <>
              <input list="plan-item-options" value={itemText} onChange={(e) => onItemText(e.target.value)} maxLength={ITEM_NAME_MAX}
                placeholder="品目（例：トマト）" autoComplete="off" aria-label="品目" aria-required="true" />
              <datalist id="plan-item-options">{catalog.items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
              {itemText.trim() && !typedItem && <span className="item-help no-listing" role="status">{NO_LISTING}</span>}
              {typedItem && typedItem.name !== itemText.trim() && <span className="item-help">「{typedItem.name}」で探します</span>}
            </>
          ) : (
            <select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value, varietyId: "" })} aria-label="品目" aria-required="true">
              <option value="">品目を選ぶ</option>
              {catalog.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          )}
          {item && item.varieties.length > 1 && (
            <select value={form.varietyId} onChange={(e) => set("varietyId", e.target.value)} aria-label="品種">
              <option value="">品種の指定なし（同じ品種どうしで組みます）</option>
              {item.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
        </>
      ),
    },
    {
      key: "qty", label: "数量", icon: "weight", f: ["quantityKg"], value: form.quantityKg ? `${form.quantityKg}kg` : "",
      editor: () => (
        <span className="with-unit">
          <input type="number" inputMode="numeric" min={1} max={100} step={1} value={form.quantityKg} onChange={(e) => set("quantityKg", e.target.value)} placeholder="10" aria-label="数量（kg）" aria-required="true" />
          <em>kg</em>
        </span>
      ),
    },
    {
      key: "date", label: "受け取り日", icon: "calendar", f: ["desiredDate"], value: form.desiredDate ? formatDateJa(form.desiredDate) : "",
      editor: () => (
        <>
          <input type="date" min={today} value={form.desiredDate} onChange={(e) => setForm({ ...form, desiredDate: e.target.value, slotId: "" })} aria-label="受け取りたい日" aria-required="true" />
          {dateCands.length > 1 && (
            <div className="date-cands" role="group" aria-label="日付の候補">
              {dateCands.map((c) => (
                <button key={c.id} type="button" className={form.desiredDate === c.id ? "btn-primary" : "btn-secondary"} onClick={() => setForm({ ...form, desiredDate: c.id, slotId: "" })}>{c.label}</button>
              ))}
            </div>
          )}
        </>
      ),
    },
    {
      key: "budget", label: "予算（税込）", icon: "yen", f: ["budget"],
      value: form.budgetMode === "none" ? "上限なし" : form.budgetMode === "limit" && form.budgetYen ? `¥${Number(form.budgetYen).toLocaleString("ja-JP")}まで` : "",
      editor: () => (
        <>
          <div className="seg" role="radiogroup" aria-label="予算">
            <label><input type="radio" name="budget" checked={form.budgetMode === "limit"} onChange={() => set("budgetMode", "limit")} />金額を指定</label>
            <label><input type="radio" name="budget" checked={form.budgetMode === "none"} onChange={() => set("budgetMode", "none")} />上限なし</label>
          </div>
          {form.budgetMode === "limit" && (
            <span className="with-unit">
              <input type="number" inputMode="numeric" min={1} step={1} value={form.budgetYen} onChange={(e) => set("budgetYen", e.target.value)} placeholder="8000" aria-label="予算（円）" />
              <em>円まで</em>
            </span>
          )}
          <span className="item-help">受け渡し費用を含めた合計で判定します。</span>
        </>
      ),
    },
    {
      key: "origin", label: "産地", icon: "pin", f: ["originPrefectures"], value: form.originPrefectures.join("・"),
      editor: () => (
        <div className="pick" role="group" aria-label="産地">
          {prefs.map((p) => (
            <label key={p}>
              <input type="checkbox" checked={form.originPrefectures.includes(p)}
                onChange={(e) => set("originPrefectures", e.target.checked ? [...form.originPrefectures, p] : form.originPrefectures.filter((x) => x !== p))} />
              {p}産
            </label>
          ))}
        </div>
      ),
    },
    {
      key: "slot", label: "受け取り時間と場所", icon: "truck", f: ["slotId"], wide: true,
      // 選ばなければ「おまかせ」：希望日に受け取れる場所から、必要量を確保できて受け取りがまとまる案を探す
      value: slot ? `${jstTimeOf(slot.startAt)}〜${jstTimeOf(slot.endAt)}・${slot.placeName}` : autoSlot ? "おまかせ（おすすめを探します）" : "",
      editor: () => slots.length === 0 ? (
        <p className="item-help">{form.desiredDate ? "この日に受け取れる時間と場所はありません。日付を確認してください。" : "先に受け取り日を選んでください。"}</p>
      ) : (
        <div className="option-cards" role="radiogroup" aria-label="受け取り時間と場所">
          {autoSlot && <label className="option-card">
            <input type="radio" name="slot" checked={form.slotId === ""} onChange={() => set("slotId", "")} />
            <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
            <span>
              <b>おまかせ</b>
              <small>この日に受け取れる場所から、必要な量を確保でき、受け取りがまとまる案を探します</small>
            </span>
          </label>}
          {slots.map((s) => (
            <label key={s.id} className="option-card">
              <input type="radio" name="slot" checked={form.slotId === s.id} onChange={() => set("slotId", s.id)} />
              <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
              <span>
                <b>{jstTimeOf(s.startAt)}〜{jstTimeOf(s.endAt)}　{s.placeName}</b>
                <small>受け渡し費用 {s.feeConfirmed ? `¥${s.feeYen.toLocaleString("ja-JP")}` : "未確認"}・上限 {s.maxKg}kg・締切 {formatJstDateTime(s.confirmDeadlineAt)}{slotCands.has(s.id) && extraction?.extracted.handoverText ? "・文章の場所に合う候補" : ""}</small>
              </span>
            </label>
          ))}
        </div>
      ),
    },
    {
      key: "first", label: "初めての農家", icon: "sprout", f: ["allowFirstTime"], value: yn(form.allowFirstTime, "含めない", "含める"),
      editor: () => (
        <>
          <Seg name="q-first" value={form.allowFirstTime} onChange={(v) => set("allowFirstTime", v)} no="含めない" yes="含める" labelId="lbl-first" />
          <span className="item-help">取引経験はお店の申告です。品質の保証ではありません。</span>
        </>
      ),
    },
    {
      key: "irr", label: "規格外（形が不ぞろい）", icon: "leaf", f: ["allowIrregular"], value: yn(form.allowIrregular, "含めない", "含める"),
      editor: () => <Seg name="q-irr" value={form.allowIrregular} onChange={(v) => set("allowIrregular", v)} no="含めない" yes="含める" labelId="lbl-irr" />,
    },
    {
      key: "mixv", label: "違う品種をまぜる", icon: "basket", f: ["allowMixedVarieties"], value: yn(form.allowMixedVarieties, "まぜない", "まぜてよい"),
      editor: () => <Seg name="q-mixv" value={form.allowMixedVarieties} onChange={(v) => set("allowMixedVarieties", v)} no="まぜない" yes="まぜてよい" labelId="lbl-mixv" />,
    },
    {
      key: "mixg", label: "通常品と規格外品をまぜる", icon: "box", f: ["allowMixedGrades"], value: yn(form.allowMixedGrades, "まぜない", "まぜてよい"),
      editor: () => <Seg name="q-mixg" value={form.allowMixedGrades} onChange={(v) => set("allowMixedGrades", v)} no="まぜない" yes="まぜてよい" labelId="lbl-mixg" />,
    },
    {
      key: "pref", label: "優先したい農家", icon: "store", f: ["preferredProducerId"],
      value: catalog.priorTradeProducers.find((p) => p.id === form.preferredProducerId)?.name ?? "指定なし",
      editor: () => (
        <>
          <select value={form.preferredProducerId} onChange={(e) => set("preferredProducerId", e.target.value)} aria-label="優先したい農家">
            <option value="">指定なし</option>
            {catalog.priorTradeProducers.map((p) => <option key={p.id} value={p.id}>{p.name}（取引経験あり）</option>)}
          </select>
          <span className="item-help">「必ず」ではありません。仕入れ先が少ない案を先に選びます。</span>
        </>
      ),
    },
  ];

  const isMissing = (x: Field) => x.f.some((f) => missing.includes(f));
  // 画面を開いた時点で未選択だった項目は「選んでください」に固定する（入力中に場所が動かないように）
  const [needKeys] = useState(() => fields.filter(isMissing).map((x) => x.key));
  const [open, setOpen] = useState<string | null>(null);
  const needList = fields.filter((x) => needKeys.includes(x.key));
  const tiles = fields.filter((x) => !needKeys.includes(x.key));
  const readCount = fields.filter((x) => x.f.some((f) => aiFields.includes(f)) && !isMissing(x)).length;

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} aria-labelledby="step2-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <h1 className="display" id="step2-title">この内容で合っていますか？</h1>

      {/* まとめ：読み取れた数と、残りの数（「読み取り済み」はここで1回だけ示す） */}
      <div className="summary-card">
        <div className="summary-line">
          {extraction ? <span className="read-count"><b className="num">{readCount}</b>項目を読み取りました</span> : <span className="read-count">項目を選んでください</span>}
          {missing.length > 0 ? <span className="left-count">あと<b className="num">{missing.length}</b>項目</span> : <span className="done-count">すべて入力済み</span>}
        </div>
        {sourceText && (
          <details className="source-quote">
            <summary>元の文を見る</summary>
            <p>{sourceText}</p>
          </details>
        )}
      </div>
      {extraction?.notices.map((n) => <div className="alert warn" key={n} role="status"><Icon name="alert" />{plainResolveNotice(n)}</div>)}
      {required && <div className="alert warn" role="status"><Icon name="alert" />農家を必ず指定することは、今回はできません。優先したい場合は「優先したい農家」で選んでください。</div>}

      {/* 未選択の項目：最初から入力・選択できる状態で先に見せる */}
      {needList.length > 0 && (
        <section className="need-card" aria-labelledby="need-title">
          <h2 className="need-title" id="need-title">選んでください</h2>
          {needList.map((x) => (
            <div key={x.key} className={`need-row ${isMissing(x) ? "need" : "filled"}`}>
              <div className="need-head">
                <Icon name={isMissing(x) ? x.icon : "check"} size={22} />
                <span className="need-label" id={`lbl-${x.key}`}>{x.label}</span>
              </div>
              {x.editor()}
            </div>
          ))}
        </section>
      )}

      {/* 決まっている項目：アイコン＋項目＋値のタイル。押すとその場で修正できる */}
      <section aria-label="決まっている項目">
        <div className="tiles">
          {tiles.map((x) => open === x.key ? (
            <div key={x.key} className="tile open" role="group" aria-labelledby={`lbl-${x.key}`}>
              <div className="tile-head">
                <span className="tile-icon" aria-hidden="true"><Icon name={x.icon} size={22} /></span>
                <span className="tile-label" id={`lbl-${x.key}`}>{x.label}</span>
              </div>
              {x.editor()}
              <button type="button" className="btn-secondary btn-block" onClick={() => setOpen(null)}>閉じる</button>
            </div>
          ) : (
            <button key={x.key} type="button" className={`tile ${x.wide ? "wide" : ""} ${isMissing(x) ? "need" : ""}`} onClick={() => setOpen(x.key)} aria-label={`${x.label}：${x.value || "未選択"}（修正する）`}>
              <span className="tile-head">
                <span className="tile-icon" aria-hidden="true"><Icon name={x.icon} size={22} /></span>
                <span className="tile-label">{x.label}</span>
              </span>
              <span className="tile-value">{isMissing(x) ? "選んでください" : x.value}</span>
              <span className="tile-edit" aria-hidden="true"><Icon name="edit" size={16} />修正</span>
            </button>
          ))}
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
