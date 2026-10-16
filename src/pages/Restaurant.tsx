import { useCallback, useEffect, useState } from "react";
import type { PlanRequest, PlanResult } from "../lib/allocate.js";
import { PLAN_NOTICE } from "../lib/constants.js";
import { formatJstDateTime, jstDate, jstDateOf, jstTimeOf } from "../lib/dates.js";
import { EXCLUSION_TEXT, headlineText, NOTICE_TEXT, rankingText, REASON_TEXT, STATUS_TEXT } from "../lib/reasons.js";
import type { Suggestion } from "../lib/suggest.js";
import { Icon } from "../components/Icon";
import type { Me } from "../App";

// 飲食店の仕入れ案（手入力）。条件をすべて利用者が確定してから POST /api/plan へ送る。
// Phase 4 で自然文入力＋条件確認画面に置き換える。

type Options = {
  now: string;
  demoClock: boolean;
  items: { id: string; name: string; varieties: { id: string; name: string }[] }[];
  slots: { id: string; label: string; placeName: string; startAt: string; endAt: string; confirmDeadlineAt: string; feeYen: number; feeConfirmed: boolean; maxKg: number }[];
  nearbyPrefectures: string[];
  priorTradeProducers: { id: string; name: string }[];
};

type YesNo = "" | "yes" | "no";
type Form = {
  itemId: string;
  varietyId: string; // "" は指定なし
  quantityKg: string;
  desiredDate: string;
  budgetMode: "" | "limit" | "none";
  budgetYen: string;
  originPrefectures: string[];
  slotId: string;
  allowFirstTime: YesNo;
  allowIrregular: YesNo;
  allowMixedVarieties: YesNo;
  allowMixedGrades: YesNo;
  preferredProducerId: string;
};

type Shown = { plan: PlanResult; version: string; request: PlanRequest; suggestions: Suggestion[]; demoClock: boolean };

const EMPTY: Form = {
  itemId: "", varietyId: "", quantityKg: "", desiredDate: "", budgetMode: "", budgetYen: "", originPrefectures: [], slotId: "",
  allowFirstTime: "", allowIrregular: "", allowMixedVarieties: "no", allowMixedGrades: "no", preferredProducerId: "",
};

// 表示中の案は店（ログインユーザー）ごとに保存する。別の店の案を表示しない
const storageKey = (userId: string) => `ai-chiiki:restaurant:v3:${userId}`;

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const yn = (v: YesNo) => (v === "" ? null : v === "yes");

function load(userId: string): { form: Form; shown: Shown | null } | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(userId: string, form: Form, shown: Shown | null) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ form, shown }));
  } catch {}
}

/** 未選択の項目は null／未入力のまま送り、サーバーで「選択してください」と返す（推測で埋めない） */
function toBody(f: Form) {
  return {
    itemId: f.itemId,
    varietyId: f.varietyId || null,
    quantityKg: f.quantityKg,
    desiredDate: f.desiredDate,
    budgetYen: f.budgetMode === "none" ? null : f.budgetMode === "limit" ? f.budgetYen : undefined,
    originPrefectures: f.originPrefectures,
    slotId: f.slotId,
    allowFirstTime: yn(f.allowFirstTime),
    allowIrregular: yn(f.allowIrregular),
    allowMixedVarieties: yn(f.allowMixedVarieties),
    allowMixedGrades: yn(f.allowMixedGrades),
    preferredProducerId: f.preferredProducerId || null,
  };
}

function fromRequest(r: PlanRequest): Form {
  const b = (v: boolean): YesNo => (v ? "yes" : "no");
  return {
    itemId: r.itemId, varietyId: r.varietyId ?? "", quantityKg: String(r.quantityKg), desiredDate: r.desiredDate,
    budgetMode: r.budgetYen === null ? "none" : "limit", budgetYen: r.budgetYen === null ? "" : String(r.budgetYen),
    originPrefectures: r.originPrefectures, slotId: r.slotId, allowFirstTime: b(r.allowFirstTime), allowIrregular: b(r.allowIrregular),
    allowMixedVarieties: b(r.allowMixedVarieties), allowMixedGrades: b(r.allowMixedGrades), preferredProducerId: r.preferredProducerId ?? "",
  };
}

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

/** 表示中の案が最新か。checking の間は以前の結果を有効扱いしない */
export type Freshness = "checking" | "fresh" | "stale";

export default function RestaurantPage({ me }: { me: Me }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [shown, setShown] = useState<Shown | null>(null);
  const [freshness, setFreshness] = useState<Freshness>("checking");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [optionsError, setOptionsError] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const saved = load(me.id);
    if (saved) {
      setForm({ ...EMPTY, ...saved.form });
      setShown(saved.shown);
      setFreshness("checking"); // 保存していた案は、最新の版と照合できるまで有効扱いしない
    }
    setRestored(true);
    fetch("/api/plan-options", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setOptions)
      .catch(() => setOptionsError(true));
  }, [me.id]);

  useEffect(() => {
    if (restored) save(me.id, form, shown);
  }, [form, shown, restored, me.id]);

  // 表示中の案の計算後に供給・枠などが変わったら、その案を無効にする。
  // 画面を開いた（戻った）とき・タブに戻ったときに確認する（常時の通信はしない）
  const checkVersion = useCallback(async () => {
    if (!shown) return;
    try {
      const q = new URLSearchParams({ itemId: shown.request.itemId, slotId: shown.request.slotId });
      const r = await fetch(`/api/inventory-version?${q}`, { cache: "no-store" });
      if (!r.ok) return setFreshness("stale");
      const { version } = await r.json();
      setFreshness(version === shown.version ? "fresh" : "stale");
    } catch {
      setFreshness("stale");
    }
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    checkVersion();
    const onFocus = () => document.visibilityState === "visible" && checkVersion();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [shown, checkVersion]);

  async function requestPlan(body: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "条件を読み取れません");
        return;
      }
      setShown(d);
      setFreshness("fresh");
      setTimeout(() => document.querySelector(".result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const item = options?.items.find((i) => i.id === form.itemId);
  const today = options ? jstDate(0, new Date(options.now)) : jstDate();

  /** 変更候補は自動適用しない：フォームに反映し、利用者が内容を確認してから再計算する */
  function applySuggestion(s: Suggestion) {
    if (!shown) return;
    const base = fromRequest(shown.request);
    const c = s.change ?? {};
    setForm({
      ...base,
      ...(c.allowFirstTime !== undefined && { allowFirstTime: c.allowFirstTime ? "yes" : "no" }),
      ...(c.allowIrregular !== undefined && { allowIrregular: c.allowIrregular ? "yes" : "no" }),
      ...(c.allowMixedVarieties !== undefined && { allowMixedVarieties: c.allowMixedVarieties ? "yes" : "no" }),
      ...(c.allowMixedGrades !== undefined && { allowMixedGrades: c.allowMixedGrades ? "yes" : "no" }),
      ...(c.quantityKg !== undefined && { quantityKg: String(c.quantityKg) }),
    });
    setNotice(`「${s.label}」をフォームに反映しました。条件を確認して「仕入れ案を作る」を押してください。`);
    setTimeout(() => document.querySelector(".qform")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function fillDemo() {
    if (!options) return;
    const tomato = options.items.find((i) => i.name === "トマト") ?? options.items[0];
    const gp = options.slots.find((s) => s.label === "G-P") ?? options.slots[0];
    setForm({
      ...EMPTY, itemId: tomato?.id ?? "", quantityKg: "10", desiredDate: gp ? jstDateOf(gp.startAt) : "", budgetMode: "limit", budgetYen: "8000",
      originPrefectures: ["大阪府"], slotId: gp?.id ?? "", allowFirstTime: "yes", allowIrregular: "no",
      preferredProducerId: options.priorTradeProducers[0]?.id ?? "",
    });
  }

  const busyLabel = (
    <>
      <span className="spinner" aria-hidden="true" />
      計算中…
    </>
  );

  return (
    <div className="page">
      <header className="page-head">
        <p className="page-role buyer"><Icon name="store" />飲食店の方</p>
        <h1>仕入れ案を作る</h1>
        <p className="lead">条件を確定すると、登録された供給から「誰から何kg・費用込みでいくら・いつどこで受け取るか」を計算します。</p>
        <p className="hint">条件を手入力で確定します（自然文入力は今後追加）。計算は登録条件の照合だけで、AIは使いません。</p>
      </header>

      {optionsError && <div className="alert bad" role="alert"><Icon name="alert" />選択肢を読み込めませんでした。再読み込みしてください。</div>}

      <form
        className="qform"
        onSubmit={(e) => {
          e.preventDefault();
          requestPlan(toBody(form));
        }}
      >
        <div className="qform-tools">
          <button type="button" className="ghost" onClick={fillDemo} disabled={!options}>
            例を入力：10月23日に大阪産トマト10kg、受渡費込み8,000円以内、A農園優先、初回もOK
          </button>
        </div>

        <section className="q" aria-labelledby="q1">
          <h2 className="q-title" id="q1"><span className="q-no">1</span>何を、どれくらい？<span className="req">必須</span></h2>
          <div className="row">
            <label className="field">
              <span className="label">品目</span>
              <select value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value, varietyId: "" }))} aria-required="true">
                <option value="">選択してください</option>
                {options?.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">数量（kg）</span>
              <span className="with-unit">
                <input type="number" inputMode="numeric" min={1} max={100} step={1} value={form.quantityKg} onChange={(e) => set("quantityKg", e.target.value)} placeholder="例：10" aria-required="true" />
                <em>kg</em>
              </span>
            </label>
          </div>
          <label className="field">
            <span className="label">品種</span>
            <select value={form.varietyId} onChange={(e) => set("varietyId", e.target.value)}>
              <option value="">指定なし（同じ品種どうしで組みます）</option>
              {item?.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <span className="hint">整数kg・1〜100kgに対応しています。</span>
        </section>

        <section className="q" aria-labelledby="q2">
          <h2 className="q-title" id="q2"><span className="q-no">2</span>いつ、どこで受け取る？<span className="req">必須</span></h2>
          <label className="field">
            <span className="label">受け取りたい日</span>
            <input type="date" min={today} value={form.desiredDate} onChange={(e) => set("desiredDate", e.target.value)} aria-required="true" />
          </label>
          <label className="field">
            <span className="label">受渡枠（受取場所・時間）</span>
            <select value={form.slotId} onChange={(e) => set("slotId", e.target.value)} aria-required="true">
              <option value="">選択してください</option>
              {options?.slots.map((s) => <option key={s.id} value={s.id}>{slotText(s)}</option>)}
            </select>
            <span className="hint">同じ受渡枠の供給だけを組み合わせます。枠の受渡費は1案につき1回だけかかります。</span>
          </label>
        </section>

        <section className="q" aria-labelledby="q3">
          <h2 className="q-title" id="q3"><span className="q-no">3</span>産地と予算<span className="req">必須</span></h2>
          <fieldset className="field">
            <legend className="label">産地（どこで採れたか。受取場所とは別）</legend>
            <div className="choice">
              {options?.nearbyPrefectures.map((p) => (
                <label key={p}>
                  <input
                    type="checkbox"
                    checked={form.originPrefectures.includes(p)}
                    onChange={(e) => set("originPrefectures", e.target.checked ? [...form.originPrefectures, p] : form.originPrefectures.filter((x) => x !== p))}
                  />
                  <span>{p}産</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <span className="label" id="budget-title">予算（税込・受渡費込み）</span>
            <div className="choice" role="radiogroup" aria-labelledby="budget-title" aria-required="true">
              <label>
                <input type="radio" name="budget" checked={form.budgetMode === "limit"} onChange={() => set("budgetMode", "limit")} />
                <span>上限あり<small>金額を入力する</small></span>
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

        <section className="q" aria-labelledby="q4-title">
          <h2 className="q-title" id="q4-title"><span className="q-no">4</span>初回の農家も含める？<span className="req">必須</span></h2>
          <YesNoChoice name="q4" value={form.allowFirstTime} onChange={(v) => set("allowFirstTime", v)}
            yes={["含める", "取引経験のない農家も候補にする"]} no={["含めない", "取引経験のある農家だけ"]} />
          <p className="hint">取引経験は店の申告情報です。品質や信用の保証ではありません。</p>
        </section>

        <section className="q" aria-labelledby="q5-title">
          <h2 className="q-title" id="q5-title"><span className="q-no">5</span>規格外（形の不揃い等）も使える？<span className="req">必須</span></h2>
          <YesNoChoice name="q5" value={form.allowIrregular} onChange={(v) => set("allowIrregular", v)}
            yes={["使える", "規格外品も候補にする"]} no={["使わない", "通常品だけ"]} />
        </section>

        <details className="more">
          <summary>
            <span className="more-title">詳しい条件<span className="opt">任意</span></span>
            <span className="more-value">
              品種の混在：{form.allowMixedVarieties === "yes" ? "許可" : "しない"}／規格の混在：{form.allowMixedGrades === "yes" ? "許可" : "しない"}／優先：
              {options?.priorTradeProducers.find((p) => p.id === form.preferredProducerId)?.name ?? "なし"}
            </span>
            <Icon name="chevronDown" className="chev" />
          </summary>
          <div className="more-body">
            <div className="field">
              <span className="label" id="q6-title">異なる品種を混ぜてよい？</span>
              <YesNoChoice name="q6" value={form.allowMixedVarieties} onChange={(v) => set("allowMixedVarieties", v)}
                yes={["混ぜてよい", "品質が等しいとは限りません"]} no={["混ぜない", "同じ品種どうしで組む"]} />
            </div>
            <div className="field">
              <span className="label" id="q7-title">通常品と規格外品を混ぜてよい？</span>
              <YesNoChoice name="q7" value={form.allowMixedGrades} onChange={(v) => set("allowMixedGrades", v)}
                yes={["混ぜてよい", "規格外を使える場合のみ"]} no={["混ぜない", "同じ規格どうしで組む"]} />
            </div>
            <label className="field">
              <span className="label">優先したい取引先</span>
              <select value={form.preferredProducerId} onChange={(e) => set("preferredProducerId", e.target.value)}>
                <option value="">指定なし</option>
                {options?.priorTradeProducers.map((p) => <option key={p.id} value={p.id}>{p.name}（取引経験あり）</option>)}
              </select>
              <span className="hint">優先は必須条件ではありません。仕入れ先の数が少ない案を先に選びます。</span>
            </label>
          </div>
        </details>

        {notice && <div className="alert warn" role="status"><Icon name="info" />{notice}</div>}
        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}

        <button type="submit" className="primary large block" disabled={busy || !options} aria-busy={busy}>
          {busy ? busyLabel : "仕入れ案を作る"}
        </button>
      </form>

      {shown && (
        <PlanView
          shown={shown}
          freshness={freshness}
          busy={busy}
          busyLabel={busyLabel}
          onRecalc={() => requestPlan(shown.request)}
          onSuggestion={applySuggestion}
        />
      )}
    </div>
  );
}

/** 無効な案の数値には取り消し線と「無効」を付ける */
function Num({ children, stale }: { children: React.ReactNode; stale: boolean }) {
  return (
    <>
      <span className="num">{children}</span>
      {stale && <span className="void-mark">無効</span>}
    </>
  );
}

function PlanView({ shown, freshness, busy, busyLabel, onRecalc, onSuggestion }: {
  shown: Shown; freshness: Freshness; busy: boolean; busyLabel: React.ReactNode; onRecalc: () => void; onSuggestion: (s: Suggestion) => void;
}) {
  const { plan, request } = shown;
  // 古い案・確認中の案は、再計算するまで適合状態（MATCHED）を有効扱いしない
  const stale = freshness !== "fresh";
  const ok = plan.status === "MATCHED" && !stale;
  const tone = freshness === "stale" ? "bad" : freshness === "checking" ? "warn" : ok ? "ok" : "warn";
  // 状態は色だけでなく、アイコンと言葉でも伝える
  const status = freshness === "stale"
    ? { icon: "x" as const, text: "無効：この仕入れ案は現在の情報ではありません" }
    : freshness === "checking"
      ? { icon: "refresh" as const, text: "最新の情報か確認中…" }
      : { icon: ok ? ("check" as const) : ("alert" as const), text: STATUS_TEXT[plan.status] };
  const ranking = rankingText(plan.rankingReason);

  return (
    <section className="result" aria-live="polite" aria-labelledby="result-title">
      <h2 className="result-title" id="result-title">仕入れ案</h2>

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
              <dt>総額（税込・受渡費込み）</dt>
              <dd className={ok ? "price" : "price price-sub"}>
                {plan.allocations.length === 0 ? <span className="muted">—</span> : plan.totalYen === null ? "未確定" : <Num stale={stale}>{yen(plan.totalYen)}</Num>}
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
        <p className="status-detail">この案は取引相談に使う候補です。実際の取引は各生産者への確認が必要です。連絡・注文・予約はこの画面ではできません。</p>

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
            <table className="alloc-table">
              <thead>
                <tr><th scope="col">農家</th><th scope="col">配分</th><th scope="col">商品代</th></tr>
              </thead>
              <tbody>
                {plan.allocations.map((a) => (
                  <tr key={a.supplyId} className="alloc">
                    <th scope="row">
                      <span className="name">{a.producerName}</span>
                      <span className="unit-price">{a.priceYenPerKg.toLocaleString("ja-JP")}円/kg・{a.varietyName}</span>
                      <span className={`tag ${a.priorTrade ? "on" : "off"}`}>{a.priorTrade ? "取引経験あり（店の申告）" : "初回"}</span>
                      {a.irregularReason && <span className="tag irregular">規格外：{a.irregularReason}</span>}
                      {!a.participationConfirmed && <span className="tag irregular">受渡枠への参加確認が必要</span>}
                    </th>
                    <td className="qty"><Num stale={stale}>{a.kg}<small>kg</small></Num></td>
                    <td className="yen"><Num stale={stale}>{yen(a.subtotalYen)}</Num></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">合計</th>
                  <td className="qty"><Num stale={stale}>{plan.fulfilledKg}<small>kg</small></Num></td>
                  <td className="yen"><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {plan.allocations.length > 0 && (
          <section className="section" aria-labelledby="money-title">
            <h3 id="money-title">金額</h3>
            <dl className="price-rows">
              <dt>商品代（税込）</dt><dd><Num stale={stale}>{yen(plan.productSubtotalYen)}</Num></dd>
              <dt>受渡費（1案につき1回）</dt><dd>{plan.handoverFeeYen === null ? "未確認" : <Num stale={stale}>{yen(plan.handoverFeeYen)}</Num>}</dd>
              <dt>総額</dt><dd>{plan.totalYen === null ? "未確定" : <Num stale={stale}>{yen(plan.totalYen)}</Num>}</dd>
              {plan.budgetYen !== null && (
                <>
                  <dt>予算</dt>
                  <dd>{yen(plan.budgetYen)}{plan.budgetStatus === "UNKNOWN" ? "（総額未確定のため判定保留）" : "以内"}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        {shown.suggestions.length > 0 && !stale && (
          <section className="section suggestion" aria-labelledby="sugg-title">
            <h3 id="sugg-title">条件を変更する場合</h3>
            <p className="hint">選んだ内容はフォームに反映されるだけです。勝手に条件を変えて計算することはありません。</p>
            <div className="qform-tools">
              {shown.suggestions.map((s) => (
                <button key={s.type} type="button" className="ghost" onClick={() => onSuggestion(s)}>{s.label}</button>
              ))}
            </div>
          </section>
        )}

        {plan.excluded.length > 0 && (
          <section className="section">
            <h3>使わなかった供給</h3>
            <ul className="plain">
              {plan.excluded.map((e) => (
                <li key={e.supplyId}>{e.producerName}（{e.availableKg}kg・{e.priceYenPerKg}円/kg）：{e.details.map((d) => EXCLUSION_TEXT[d]).join("、")}</li>
              ))}
            </ul>
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

    </section>
  );
}
