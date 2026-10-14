import { useCallback, useEffect, useState } from "react";
import type { PlanRequest, PlanResult } from "../lib/allocate.js";
import { REGIONS, STATUS_LABEL, UNITS } from "../lib/constants.js";
import { formatDateJa, jstDate } from "../lib/dates.js";
import { Label } from "../components/Label";
import type { Suggestion } from "../lib/suggest.js";

type Form = {
  item: string;
  variety: string;
  quantity: string;
  unit: string;
  deadline: string;
  region: string;
  allowIrregular: "" | "yes" | "no";
  maxUnitPrice: string;
  handoverPlace: string;
  handoverFrom: string;
  handoverTo: string;
};

type Shown = { plan: PlanResult; version: string; request: PlanRequest; suggestions?: Suggestion[] };

const EMPTY: Form = {
  item: "", variety: "", quantity: "", unit: "kg", deadline: "", region: "", allowIrregular: "",
  maxUnitPrice: "", handoverPlace: "", handoverFrom: "", handoverTo: "",
};

const STORAGE_KEY = "ai-tiiki:restaurant";
const POLL_MS = 3000;

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

function load(): { form: Form; shown: Shown | null } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(form: Form, shown: Shown | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ form, shown }));
  } catch {}
}

function toBody(f: Form) {
  return {
    item: f.item,
    variety: f.variety,
    quantity: f.quantity,
    unit: f.unit,
    deadline: f.deadline,
    region: f.region,
    allowIrregular: f.allowIrregular === "" ? null : f.allowIrregular === "yes",
    maxUnitPrice: f.maxUnitPrice,
    handoverPlace: f.handoverPlace,
    handoverFrom: f.handoverFrom,
    handoverTo: f.handoverTo,
  };
}

export default function RestaurantPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [shown, setShown] = useState<Shown | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const saved = load();
    if (saved) {
      setForm({ ...EMPTY, ...saved.form });
      setShown(saved.shown);
    }
    setRestored(true);
    fetch("/api/listings")
      .then((r) => r.json())
      .then((d: { listings: { handoverPlace: string }[] }) =>
        setPlaces([...new Set(d.listings.map((l) => l.handoverPlace))]),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (restored) save(form, shown);
  }, [form, shown, restored]);

  // 表示中の案が作られた後に出品が変わったら、その案を無効にする
  const checkVersion = useCallback(async () => {
    if (!shown) return;
    try {
      const r = await fetch("/api/inventory-version", { cache: "no-store" });
      const { version } = await r.json();
      setStale(version !== shown.version);
    } catch {}
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    checkVersion();
    const id = setInterval(checkVersion, POLL_MS);
    const onFocus = () => checkVersion();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [shown, checkVersion]);

  async function requestPlan(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "条件を読み取れません");
        return;
      }
      setShown(d);
      setStale(false);
      // スマホではフォームの下に結果が出るので、結果の先頭まで移動する
      setTimeout(() => document.querySelector(".result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <h1>仕入れ案を作る</h1>
      <p className="lead">必要な食材と量を入れると、地域の複数の農家を組み合わせた仕入れ案を作ります。</p>

      <section className="card">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.item.trim() && !form.quantity && !form.deadline) {
              setError("品目・数量・希望日を入力してください");
              return;
            }
            requestPlan(toBody(form));
          }}
        >
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setForm({ ...EMPTY, item: "トマト", quantity: "10", deadline: jstDate(2), region: "大阪近郊", allowIrregular: "yes" })
            }
          >
            例を入力：明後日までに大阪近郊のトマト10kg、規格外OK
          </button>

          <label className="field">
            <Label required>品目</Label>
            <input value={form.item} onChange={(e) => set("item", e.target.value)} placeholder="例：トマト" maxLength={30} aria-required="true" />
          </label>

          <div className="row">
            <label className="field">
              <Label required>数量</Label>
              <input type="number" inputMode="numeric" min={1} step={1} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="例：10" aria-required="true" />
            </label>
            <label className="field">
              <Label required>単位</Label>
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)} aria-required="true">
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          </div>

          <label className="field">
            <Label required>希望日（この日までに受け取り）</Label>
            <input type="date" min={jstDate()} value={form.deadline} onChange={(e) => set("deadline", e.target.value)} aria-required="true" />
          </label>

          <label className="field">
            <Label required>地域</Label>
            <select value={form.region} onChange={(e) => set("region", e.target.value)} aria-required="true">
              <option value="">選択してください</option>
              {REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>

          <fieldset aria-required="true">
            <legend><Label required>規格外（形の不揃い・余剰など）</Label></legend>
            <div className="choice">
              <label><input type="radio" name="irr" checked={form.allowIrregular === "yes"} onChange={() => set("allowIrregular", "yes")} />可</label>
              <label><input type="radio" name="irr" checked={form.allowIrregular === "no"} onChange={() => set("allowIrregular", "no")} />不可</label>
            </div>
          </fieldset>

          <label className="field">
            <Label>品種</Label>
            <input value={form.variety} onChange={(e) => set("variety", e.target.value)} placeholder="例：桃太郎（空欄なら指定なし）" maxLength={30} />
            <span className="hint">指定すると、同じ品種が登録された出品だけを使います</span>
          </label>

          <label className="field">
            <Label>税込単価の上限</Label>
            <div className="with-unit">
              <input type="number" inputMode="numeric" min={1} step={1} value={form.maxUnitPrice} onChange={(e) => set("maxUnitPrice", e.target.value)} placeholder="空欄なら指定なし" />
              <em>円/{form.unit}</em>
            </div>
          </label>

          <label className="field">
            <Label>受渡場所</Label>
            <select value={form.handoverPlace} onChange={(e) => set("handoverPlace", e.target.value)}>
              <option value="">指定なし</option>
              {[...new Set([...places, ...(form.handoverPlace ? [form.handoverPlace] : [])])].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>

          <div className="field">
            <Label>受け取れる時間帯</Label>
            <div className="row">
              <label className="field">
                <span className="sub-label">開始</span>
                <input type="time" aria-label="開始" value={form.handoverFrom} onChange={(e) => set("handoverFrom", e.target.value)} />
              </label>
              <label className="field">
                <span className="sub-label">終了</span>
                <input type="time" aria-label="終了" value={form.handoverTo} onChange={(e) => set("handoverTo", e.target.value)} />
              </label>
            </div>
            <span className="hint">指定すると、受渡時間がこの時間帯に収まる出品だけを使います</span>
          </div>

          {error && <div className="alert bad" role="alert">{error}</div>}

          <button type="submit" className="primary block" disabled={busy}>
            {busy ? "計算中…" : "仕入れ案を作る"}
          </button>
        </form>
      </section>

      {shown && (
        <PlanView
          shown={shown}
          stale={stale}
          busy={busy}
          onRecalc={() => requestPlan(shown.request)}
          onAllowIrregular={() => {
            // 利用者が押したときだけ条件を変え、最新の DB から計算し直す
            set("allowIrregular", "yes");
            requestPlan({ ...shown.request, allowIrregular: true });
          }}
        />
      )}
    </>
  );
}

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
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

function PlanView({ shown, stale, busy, onRecalc, onAllowIrregular }: {
  shown: Shown; stale: boolean; busy: boolean; onRecalc: () => void; onAllowIrregular: () => void;
}) {
  const { plan, request } = shown;
  const irregularSuggestion = shown.suggestions?.find((x) => x.type === "allow_irregular");
  const u = plan.unit;
  const ok = plan.status === "fulfilled";

  // 状態は色だけでなく、記号と言葉でも伝える
  const chip = stale
    ? { tone: "bad", text: "× 無効な案（在庫が変わる前の計算）" }
    : ok
      ? { tone: "ok", text: "✓ 必要量を満たしています" }
      : plan.status === "handover_mismatch"
        ? { tone: "warn", text: "！ 同じ日時・場所では揃いません" }
        : { tone: "warn", text: "！ 必要量に足りません" };
  const headline = ok
    ? `希望${plan.requested}${u}を満たす仕入れ案です`
    : plan.status === "none"
      ? "条件に合う出品がありません"
      : `あと${plan.shortage}${u}足りません`;

  return (
    <section className="result" aria-live="polite">
      <h2>仕入れ案</h2>

      {stale && (
        <div className="alert bad stale-banner" role="alert">
          <div className="stale-title">× この仕入れ案は無効です</div>
          <p>出品の数量や公開状態が変わったため、下の数量・金額はもう使えません。最新の在庫で再計算してください。</p>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="primary block" onClick={onRecalc} disabled={busy}>
              {busy ? "計算中…" : "同じ条件で再計算"}
            </button>
          </div>
        </div>
      )}

      <div className={`stack ${stale ? "is-stale" : ""}`}>
        <div className={`card hero summary ${stale ? "" : ok ? "ok" : "warn"}`}>
          <span className={`chip ${chip.tone}`}>{chip.text}</span>
          <p className="headline">{stale && "【無効】"}{headline}</p>
          {!ok && <p className="headline-sub">{plan.message}</p>}
          <p className="qty-line">
            案の数量 <b><Num stale={stale}>{plan.totalQuantity}{u}</Num></b>
            <span className="muted">／ 希望 {plan.requested}{u}</span>
          </p>
          <div className="price-box">
            <div className="price-label">商品代</div>
            <div className="price"><Num stale={stale}>{yen(plan.subtotal)}</Num><small>（税込）</small></div>
            <div className="price-note">
              受渡手数料 <Num stale={stale}>{yen(plan.handoverFee)}</Num>・お支払いの目安 <Num stale={stale}>{yen(plan.total)}</Num>
            </div>
          </div>
          <div className="status-note" role="note">
            <span className="status-icon" aria-hidden="true">ⓘ</span>
            <strong>状態：{STATUS_LABEL}</strong>
            <span className="status-desc">この案は取引相談に使う候補です。農家の承認・在庫の確保・決済・配送はまだ行われていません。</span>
          </div>
        </div>

        {irregularSuggestion && !stale && (
          <div className="card suggestion" role="note">
            <span className="chip ok">→ 条件を変えると満たせます</span>
            <p className="suggestion-text">{irregularSuggestion.message}</p>
            <p className="hint" style={{ margin: 0 }}>
              上は今の条件（規格外不可）で計算した結果です。ボタンを押すと、規格外を「可」に変えて、ほかの条件はそのまま最新の在庫で計算し直します。
            </p>
            <button className="primary block" onClick={onAllowIrregular} disabled={busy}>
              {busy ? "計算中…" : "規格外も含めて再計算"}
            </button>
          </div>
        )}

        <div className="card handover">
          <h3>受渡し</h3>
          {plan.handover ? (
            <>
              <div className="handover-row">
                <CalendarIcon />
                <span className="k">日時</span>
                <span className="v">{formatDateJa(plan.handover.date)} {plan.handover.start}〜{plan.handover.end}</span>
              </div>
              <div className="handover-row">
                <PinIcon />
                <span className="k">場所</span>
                <span className="v">{plan.handover.place}</span>
              </div>
            </>
          ) : (
            <p className="muted">受渡しできる組み合わせがありません</p>
          )}
        </div>

        {plan.allocations.length > 0 && (
          <>
            <div className="section-title">
              <h3 style={{ margin: 0 }}>内訳（{plan.allocations.length}軒の農家）</h3>
            </div>
            <div className="formula" aria-label="内訳の合計">
              {plan.allocations.map((a, i) => (
                <span key={a.listingId}>
                  {i > 0 && <span className="op">＋ </span>}
                  {a.producerName} <Num stale={stale}>{a.quantity}{u}</Num>
                </span>
              ))}
              <span><span className="op">＝ </span><Num stale={stale}>{plan.totalQuantity}{u}</Num></span>
            </div>

            {plan.allocations.map((a) => (
              <div className="card alloc-card" key={a.listingId}>
                <div className="alloc">
                  <span className="name">{a.producerName}</span>
                  <span className="qty"><Num stale={stale}>{a.quantity}<small>{u}</small></Num></span>
                </div>
                {a.irregularReason && <div><span className="tag irregular">規格外：{a.irregularReason}</span></div>}
                <div className="alloc meta">
                  <span>{a.unitPrice.toLocaleString("ja-JP")}円/{u}（税込）</span>
                  <span>商品代 <b><Num stale={stale}>{yen(a.subtotal)}</Num></b></span>
                </div>
              </div>
            ))}

            <div className="card">
              <div className="total-row">
                <span>合計</span>
                <span><Num stale={stale}>{plan.totalQuantity}{u}・{yen(plan.subtotal)}</Num>（税込）</span>
              </div>
              <p className="small muted" style={{ marginBottom: 0 }}>
                受渡手数料 {yen(plan.handoverFee)}（登録条件）。農家への連絡・承認、在庫確保、決済、配送はこのアプリでは行いません。
              </p>
            </div>
          </>
        )}

        {plan.status !== "fulfilled" && (
          <div className="card card-soft">
            <h3>条件を変えて再計算できます</h3>
            <ul className="plain">
              <li>数量を減らす</li>
              <li>希望日を遅らせる</li>
              {request.variety && <li>品種の指定を外す</li>}
              {!request.allowIrregular && !irregularSuggestion && <li>規格外を「可」にする（今の在庫では、これだけでは希望量に届きません）</li>}
              {(request.handoverPlace || request.handoverFrom || request.handoverTo) && <li>受渡場所・時間の指定を変える</li>}
              {request.maxUnitPrice !== null && <li>税込単価の上限を上げる</li>}
            </ul>
          </div>
        )}

        {plan.notices.map((n) => <div className="alert warn" key={n}>！ {n}</div>)}

        {plan.excluded.length > 0 && (
          <div className="card card-soft">
            <h3>使わなかった出品</h3>
            <ul className="plain small">
              {plan.excluded.map((e) => (
                <li key={e.listingId}>{e.producerName}（{e.quantity}{e.unit}）：{e.reasons.join("、")}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="small muted">
          使った条件：{request.item}{request.variety && `（${request.variety}）`} {request.quantity}{request.unit}／{formatDateJa(request.deadline)}までに受け取り／{request.region}／規格外{request.allowIrregular ? "可" : "不可"}
          {request.maxUnitPrice !== null && `／税込単価${request.maxUnitPrice}円/${request.unit}以下`}
          {request.handoverPlace && `／${request.handoverPlace}`}
          {(request.handoverFrom || request.handoverTo) && `／${request.handoverFrom ?? ""}〜${request.handoverTo ?? ""}`}
        </p>
      </div>

      <p><a href="#/producer">生産者の登録画面へ（数量の変更・公開停止）</a></p>
    </section>
  );
}
