import { useCallback, useEffect, useState } from "react";
import type { PlanRequest, PlanResult } from "../lib/allocate.js";
import { REGIONS, STATUS_LABEL, UNITS } from "../lib/constants.js";
import { formatDateJa, jstDate } from "../lib/dates.js";
import { Icon } from "../components/Icon";
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

/** 「詳しい条件」を閉じていても設定内容が分かるように要約する */
function optionalSummary(f: Form): string {
  const parts: string[] = [];
  if (f.variety.trim()) parts.push(`品種 ${f.variety.trim()}`);
  if (f.maxUnitPrice) parts.push(`上限 ${Number(f.maxUnitPrice).toLocaleString("ja-JP")}円/${f.unit}`);
  if (f.handoverPlace) parts.push(f.handoverPlace);
  if (f.handoverFrom || f.handoverTo) parts.push(`${f.handoverFrom || "—"}〜${f.handoverTo || "—"}`);
  return parts.length ? parts.join("・") : "品種・価格上限・受渡場所・時間帯：指定なし";
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
        <p className="lead">3つの質問に答えると、条件の合う農家を組み合わせた仕入れ案を作ります。</p>
      </header>

      <form
        className="qform"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.item.trim() && !form.quantity && !form.deadline) {
            setError("品目・数量・希望日を入力してください");
            return;
          }
          requestPlan(toBody(form));
        }}
      >
        <div className="qform-tools">
          <button
            type="button"
            className="ghost"
            onClick={() =>
              setForm({ ...EMPTY, item: "トマト", quantity: "10", deadline: jstDate(2), region: "大阪近郊", allowIrregular: "yes" })
            }
          >
            例を入力：明後日までに大阪近郊のトマト10kg、規格外OK
          </button>
        </div>

        <section className="q" aria-labelledby="q1">
          <h2 className="q-title" id="q1"><span className="q-no">1</span>何を、どれくらい？<span className="req">必須</span></h2>
          <label className="field">
            <span className="label">品目</span>
            <input value={form.item} onChange={(e) => set("item", e.target.value)} placeholder="例：トマト" maxLength={30} aria-required="true" />
          </label>
          <div className="row">
            <label className="field">
              <span className="label">数量</span>
              <input type="number" inputMode="numeric" min={1} step={1} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="例：10" aria-required="true" />
            </label>
            <label className="field">
              <span className="label">単位</span>
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)} aria-required="true">
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="q" aria-labelledby="q2">
          <h2 className="q-title" id="q2"><span className="q-no">2</span>いつ、どこで？<span className="req">必須</span></h2>
          <label className="field">
            <span className="label">希望日（この日までに受け取り）</span>
            <input type="date" min={jstDate()} value={form.deadline} onChange={(e) => set("deadline", e.target.value)} aria-required="true" />
          </label>
          <label className="field">
            <span className="label">地域</span>
            <select value={form.region} onChange={(e) => set("region", e.target.value)} aria-required="true">
              <option value="">選択してください</option>
              {REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        </section>

        <section className="q" aria-labelledby="q3">
          <h2 className="q-title" id="q3"><span className="q-no">3</span>形の不揃い・余剰も使える？<span className="req">必須</span></h2>
          <div className="choice" role="radiogroup" aria-labelledby="q3" aria-required="true">
            <label>
              <input type="radio" name="irr" checked={form.allowIrregular === "yes"} onChange={() => set("allowIrregular", "yes")} />
              <span>使える<small>形の不揃い・余剰の出品も組み合わせる</small></span>
            </label>
            <label>
              <input type="radio" name="irr" checked={form.allowIrregular === "no"} onChange={() => set("allowIrregular", "no")} />
              <span>使わない<small>通常品だけで組み合わせる</small></span>
            </label>
          </div>
        </section>

        <details className="more">
          <summary>
            <span className="more-title">詳しい条件<span className="opt">任意</span></span>
            <span className={`more-value ${optionalSummary(form).startsWith("品種・価格上限") ? "" : "is-set"}`}>{optionalSummary(form)}</span>
            <Icon name="chevronDown" className="chev" />
          </summary>
          <div className="more-body">
            <label className="field">
              <span className="label">品種</span>
              <input value={form.variety} onChange={(e) => set("variety", e.target.value)} placeholder="例：桃太郎（空欄なら指定なし）" maxLength={30} />
              <span className="hint">指定すると、同じ品種が登録された出品だけを使います</span>
            </label>
            <label className="field">
              <span className="label">税込単価の上限</span>
              <span className="with-unit">
                <input type="number" inputMode="numeric" min={1} step={1} value={form.maxUnitPrice} onChange={(e) => set("maxUnitPrice", e.target.value)} placeholder="空欄なら指定なし" />
                <em>円/{form.unit}</em>
              </span>
            </label>
            <label className="field">
              <span className="label">受渡場所</span>
              <select value={form.handoverPlace} onChange={(e) => set("handoverPlace", e.target.value)}>
                <option value="">指定なし</option>
                {[...new Set([...places, ...(form.handoverPlace ? [form.handoverPlace] : [])])].map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <div className="field">
              <span className="label">受け取れる時間帯</span>
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
          </div>
        </details>

        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}

        <button type="submit" className="primary large block" disabled={busy} aria-busy={busy}>
          {busy ? busyLabel : "仕入れ案を作る"}
        </button>
      </form>

      {shown && (
        <PlanView
          shown={shown}
          stale={stale}
          busy={busy}
          busyLabel={busyLabel}
          onRecalc={() => requestPlan(shown.request)}
          onAllowIrregular={() => {
            // 利用者が押したときだけ条件を変え、最新の DB から計算し直す
            set("allowIrregular", "yes");
            requestPlan({ ...shown.request, allowIrregular: true });
          }}
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

function PlanView({ shown, stale, busy, busyLabel, onRecalc, onAllowIrregular }: {
  shown: Shown; stale: boolean; busy: boolean; busyLabel: React.ReactNode; onRecalc: () => void; onAllowIrregular: () => void;
}) {
  const { plan, request } = shown;
  const irregularSuggestion = shown.suggestions?.find((x) => x.type === "allow_irregular");
  const u = plan.unit;
  const ok = plan.status === "fulfilled";
  const tone = stale ? "bad" : ok ? "ok" : "warn";

  // 状態は色だけでなく、アイコンと言葉でも伝える
  const status = stale
    ? { icon: "x" as const, text: "無効な案（在庫が変わる前の計算）" }
    : ok
      ? { icon: "check" as const, text: "希望量を満たしています" }
      : plan.status === "handover_mismatch"
        ? { icon: "alert" as const, text: "同じ日時・場所では揃いません" }
        : { icon: "alert" as const, text: "希望量に足りません" };
  const headline = ok
    ? `希望${plan.requested}${u}を満たす仕入れ案です`
    : plan.status === "none"
      ? "条件に合う出品がありません"
      : `あと${plan.shortage}${u}足りません`;

  return (
    <section className="result" aria-live="polite" aria-labelledby="result-title">
      <h2 className="result-title" id="result-title">仕入れ案</h2>

      {stale && (
        <div className="alert bad stale-banner" role="alert">
          <Icon name="alert" />
          <div>
            <strong className="stale-title">この仕入れ案は無効です</strong>
            <p>出品の数量や公開状態が変わりました。下の数量・金額は使えません。最新の在庫で計算し直してください。</p>
            <button className="primary block" onClick={onRecalc} disabled={busy} aria-busy={busy} style={{ marginTop: 12 }}>
              {busy ? busyLabel : <><Icon name="refresh" />同じ条件で再計算</>}
            </button>
          </div>
        </div>
      )}

      <div className={`result-body ${stale ? "is-stale" : ""}`}>
        {/* ひと目で把握する：満たすか・案の数量・商品代・受渡し */}
        <div className={`hero summary ${tone}`}>
          <p className={`status ${tone}`}><Icon name={status.icon} />{status.text}</p>
          <p className="headline">
            {stale && "【無効】"}
            {ok ? (
              <><span className="nowrap">希望{plan.requested}{u}を満たす</span><span className="nowrap">仕入れ案です</span></>
            ) : (
              headline
            )}
          </p>
          {!ok && <p className="headline-sub">{plan.message}</p>}

          <dl className="keyfacts">
            <div className="kf kf-qty">
              <dt>案の数量</dt>
              <dd>
                <span className="figure"><Num stale={stale}>{plan.totalQuantity}<small>{u}</small></Num></span>
                <span className="of">／ 希望 {plan.requested}{u}</span>
              </dd>
            </div>
            <div className="kf">
              <dt>商品代（税込）</dt>
              <dd className={ok ? "price" : "price price-sub"}><Num stale={stale}>{yen(plan.subtotal)}</Num></dd>
            </div>
            <div className="kf kf-handover">
              <dt>受渡し</dt>
              <dd>
                {plan.handover ? (
                  <>
                    <span className="kf-line"><Icon name="calendar" size={18} />{formatDateJa(plan.handover.date)} {plan.handover.start}〜{plan.handover.end}</span>
                    <span className="kf-line"><Icon name="pin" size={18} />{plan.handover.place}</span>
                  </>
                ) : (
                  <span className="muted">受渡しできる組み合わせがありません</span>
                )}
              </dd>
            </div>
          </dl>

          <p className="status-line"><Icon name="info" size={18} /><strong>{STATUS_LABEL}</strong></p>
        </div>
        <p className="status-detail">
          この案は取引相談に使う候補です。農家の承認・在庫の確保・決済・配送はまだ行われていません。
        </p>

        {irregularSuggestion && !stale && (
          <div className="suggestion" role="note">
            <p className="suggestion-head"><Icon name="arrowRight" />条件を変えると満たせます</p>
            <p className="suggestion-text">{irregularSuggestion.message}</p>
            <p className="suggestion-change">変わる条件：<b>形の不揃い・余剰「使わない」→「使える」</b>（ほかの条件はそのまま、最新の在庫で計算し直します）</p>
            <button className="action block large" onClick={onAllowIrregular} disabled={busy} aria-busy={busy}>
              {busy ? busyLabel : "形の不揃い・余剰も含めて再計算"}
            </button>
          </div>
        )}

        {plan.allocations.length > 0 && (
          <section className="section" aria-labelledby="alloc-title">
            <h3 id="alloc-title">農家別の配分<span className="muted">（{plan.allocations.length}軒）</span></h3>
            <table className="alloc-table">
              <thead>
                <tr><th scope="col">農家</th><th scope="col">配分</th><th scope="col">商品代</th></tr>
              </thead>
              <tbody>
                {plan.allocations.map((a) => (
                  <tr key={a.listingId} className="alloc">
                    <th scope="row">
                      <span className="name">{a.producerName}</span>
                      <span className="unit-price">{a.unitPrice.toLocaleString("ja-JP")}円/{u}</span>
                      {a.irregularReason && <span className="tag irregular">規格外：{a.irregularReason}</span>}
                    </th>
                    <td className="qty"><Num stale={stale}>{a.quantity}<small>{u}</small></Num></td>
                    <td className="yen"><Num stale={stale}>{yen(a.subtotal)}</Num></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">合計</th>
                  <td className="qty"><Num stale={stale}>{plan.totalQuantity}<small>{u}</small></Num></td>
                  <td className="yen"><Num stale={stale}>{yen(plan.subtotal)}</Num></td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {plan.allocations.length > 0 && (
          <section className="section" aria-labelledby="money-title">
            <h3 id="money-title">金額</h3>
            <dl className="price-rows">
              <dt>商品代（税込）</dt><dd><Num stale={stale}>{yen(plan.subtotal)}</Num></dd>
              <dt>受渡手数料</dt><dd><Num stale={stale}>{yen(plan.handoverFee)}</Num></dd>
              <dt>お支払いの目安</dt><dd><Num stale={stale}>{yen(plan.total)}</Num></dd>
            </dl>
            <p className="hint">受渡手数料は生産者の登録条件です。</p>
          </section>
        )}

        {plan.status !== "fulfilled" && (
          <section className="section">
            <h3>条件を変えて再計算できます</h3>
            <ul className="plain">
              <li>数量を減らす</li>
              <li>希望日を遅らせる</li>
              {request.variety && <li>品種の指定を外す</li>}
              {!request.allowIrregular && !irregularSuggestion && <li>形の不揃い・余剰を「使える」にする（今の在庫では、これだけでは希望量に届きません）</li>}
              {(request.handoverPlace || request.handoverFrom || request.handoverTo) && <li>受渡場所・時間の指定を変える</li>}
              {request.maxUnitPrice !== null && <li>税込単価の上限を上げる</li>}
            </ul>
          </section>
        )}

        {plan.notices.map((n) => <div className="alert warn" key={n}><Icon name="alert" />{n}</div>)}

        {plan.excluded.length > 0 && (
          <section className="section">
            <h3>使わなかった出品</h3>
            <ul className="plain">
              {plan.excluded.map((e) => (
                <li key={e.listingId}>{e.producerName}（{e.quantity}{e.unit}）：{e.reasons.join("、")}</li>
              ))}
            </ul>
          </section>
        )}

        <p className="used-conditions">
          使った条件：{request.item}{request.variety && `（${request.variety}）`} {request.quantity}{request.unit}／{formatDateJa(request.deadline)}までに受け取り／{request.region}／形の不揃い・余剰{request.allowIrregular ? "使える" : "使わない"}
          {request.maxUnitPrice !== null && `／税込単価${request.maxUnitPrice}円/${request.unit}以下`}
          {request.handoverPlace && `／${request.handoverPlace}`}
          {(request.handoverFrom || request.handoverTo) && `／${request.handoverFrom ?? ""}〜${request.handoverTo ?? ""}`}
        </p>
      </div>

      <a className="text-link" href="#/producer">生産者の画面で数量・公開状態を変更する<Icon name="chevronRight" size={18} /></a>
    </section>
  );
}
