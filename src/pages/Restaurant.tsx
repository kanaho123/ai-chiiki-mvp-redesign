import { useCallback, useEffect, useState } from "react";
import type { PlanRequest, PlanResult } from "../lib/allocate.js";
import { REGIONS, STATUS_LABEL, UNITS } from "../lib/constants.js";
import { formatDateJa, jstDate } from "../lib/dates.js";

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

type Shown = { plan: PlanResult; version: string; request: PlanRequest };

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
          <div className="actions">
            <button
              type="button"
              onClick={() =>
                setForm({ ...EMPTY, item: "トマト", quantity: "10", deadline: jstDate(2), region: "大阪近郊", allowIrregular: "yes" })
              }
            >
              例を入力：明後日までに大阪近郊のトマト10kg、規格外OK
            </button>
          </div>

          <label className="field">
            <span>品目</span>
            <input value={form.item} onChange={(e) => set("item", e.target.value)} placeholder="例：トマト" maxLength={30} />
          </label>

          <label className="field">
            <span>品種（任意）</span>
            <input value={form.variety} onChange={(e) => set("variety", e.target.value)} placeholder="指定なし" maxLength={30} />
            <small>指定すると、同じ品種が登録された出品だけを使います</small>
          </label>

          <div className="row">
            <label className="field">
              <span>数量</span>
              <input type="number" inputMode="numeric" min={1} step={1} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </label>
            <label className="field">
              <span>単位</span>
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          </div>

          <div className="row">
            <label className="field">
              <span>希望日（この日までに受け取り）</span>
              <input type="date" min={jstDate()} value={form.deadline} onChange={(e) => set("deadline", e.target.value)} />
            </label>
            <label className="field">
              <span>地域</span>
              <select value={form.region} onChange={(e) => set("region", e.target.value)}>
                <option value="">選択してください</option>
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend>規格外（形の不揃い・余剰など）</legend>
            <div className="radio">
              <label><input type="radio" name="irr" checked={form.allowIrregular === "yes"} onChange={() => set("allowIrregular", "yes")} />可</label>
              <label><input type="radio" name="irr" checked={form.allowIrregular === "no"} onChange={() => set("allowIrregular", "no")} />不可</label>
            </div>
          </fieldset>

          <label className="field">
            <span>税込単価の上限（任意）</span>
            <div className="with-unit">
              <input type="number" inputMode="numeric" min={1} step={1} value={form.maxUnitPrice} onChange={(e) => set("maxUnitPrice", e.target.value)} placeholder="指定なし" />
              <em>円/{form.unit}</em>
            </div>
          </label>

          <label className="field">
            <span>受渡場所（任意）</span>
            <select value={form.handoverPlace} onChange={(e) => set("handoverPlace", e.target.value)}>
              <option value="">指定なし</option>
              {[...new Set([...places, ...(form.handoverPlace ? [form.handoverPlace] : [])])].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>

          <div className="field">
            <span>受け取れる時間帯（任意）</span>
            <div className="row">
              <input type="time" aria-label="開始" value={form.handoverFrom} onChange={(e) => set("handoverFrom", e.target.value)} />
              <input type="time" aria-label="終了" value={form.handoverTo} onChange={(e) => set("handoverTo", e.target.value)} />
            </div>
            <small>指定すると、受渡時間がこの時間帯に収まる出品だけを使います</small>
          </div>

          {error && <div className="alert bad" role="alert">{error}</div>}

          <button type="submit" className="primary" disabled={busy}>
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
        />
      )}
    </>
  );
}

function PlanView({ shown, stale, busy, onRecalc }: { shown: Shown; stale: boolean; busy: boolean; onRecalc: () => void }) {
  const { plan, request } = shown;
  const u = plan.unit;
  const tone = plan.status === "fulfilled" ? "ok" : "warn";

  return (
    <section aria-live="polite">
      <h2>仕入れ案</h2>

      {stale && (
        <div className="alert bad stale-banner" role="alert">
          <strong>出品情報が変更されたため、この仕入れ案は無効です。</strong>
          <p>最新の在庫で再計算してください。</p>
          <div className="actions" style={{ marginTop: 8 }}>
            <button className="primary" onClick={onRecalc} disabled={busy}>
              {busy ? "計算中…" : "同じ条件で再計算"}
            </button>
          </div>
        </div>
      )}

      <div className={`stack ${stale ? "stale" : ""}`} aria-hidden={stale}>
        <div className="card summary">
          <div className={`alert ${tone}`}>
            <strong>{plan.message}</strong>
          </div>
          <div><span className="status-badge">状態：{STATUS_LABEL}</span></div>
          <dl>
            <dt>数量</dt>
            <dd>{plan.totalQuantity}{u}／希望{plan.requested}{u}{plan.shortage > 0 && `（${plan.shortage}${u}不足）`}</dd>
            <dt>受渡し</dt>
            <dd>
              {plan.handover
                ? `${formatDateJa(plan.handover.date)} ${plan.handover.start}〜${plan.handover.end}・${plan.handover.place}`
                : "—"}
            </dd>
            <dt>商品代</dt>
            <dd className="big">{yen(plan.subtotal)}<span className="small muted">（税込）</span></dd>
            <dt>受渡手数料</dt>
            <dd>{yen(plan.handoverFee)}</dd>
          </dl>
        </div>

        {plan.allocations.map((a) => (
          <div className="card" key={a.listingId}>
            <div className="alloc">
              <strong>{a.producerName}</strong>
              <span className="qty">{a.quantity}{u}</span>
            </div>
            <div className="alloc small muted">
              <span>{a.unitPrice.toLocaleString("ja-JP")}円/{u}（税込）</span>
              <span>商品代 {yen(a.subtotal)}</span>
            </div>
            {a.irregularReason && <span className="tag">規格外：{a.irregularReason}</span>}
          </div>
        ))}

        {plan.allocations.length > 0 && (
          <div className="card">
            <div className="total-row">
              <span>合計</span>
              <span>{plan.totalQuantity}{u}・{yen(plan.subtotal)}（税込）</span>
            </div>
            <p className="small muted" style={{ margin: "0.5rem 0 0" }}>
              受渡手数料 {yen(plan.handoverFee)}（登録条件）。農家への連絡・承認、在庫確保、決済、配送はこのアプリでは行いません。
            </p>
          </div>
        )}

        {plan.status !== "fulfilled" && (
          <div className="card">
            <strong>条件を変えて再計算できます</strong>
            <ul className="plain small">
              <li>数量を減らす</li>
              <li>希望日を遅らせる</li>
              {request.variety && <li>品種の指定を外す</li>}
              {!request.allowIrregular && <li>規格外を「可」にする</li>}
              {(request.handoverPlace || request.handoverFrom || request.handoverTo) && <li>受渡場所・時間の指定を変える</li>}
              {request.maxUnitPrice !== null && <li>税込単価の上限を上げる</li>}
            </ul>
          </div>
        )}

        {plan.notices.map((n) => <div className="alert warn" key={n}>{n}</div>)}

        {plan.excluded.length > 0 && (
          <div className="card">
            <strong>使わなかった出品</strong>
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

    </section>
  );
}
