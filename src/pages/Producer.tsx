import { useCallback, useEffect, useState } from "react";
import type { SupplyListing } from "../lib/allocate.js";
import { DEMO_PLACE, IRREGULAR_REASONS, REGIONS, UNITS } from "../lib/constants.js";
import { formatDateJa, jstDate } from "../lib/dates.js";
import { Icon } from "../components/Icon";

type Producer = { id: string; name: string };

type Form = {
  producerId: string; // "" は新しい生産者
  producerName: string;
  item: string;
  variety: string;
  availableDate: string;
  region: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  handoverPlace: string;
  handoverStart: string;
  handoverEnd: string;
  minQuantity: string;
  step: string;
  handoverFee: string;
  irregularReason: string;
};

const initialForm = (): Form => ({
  producerId: "", producerName: "", item: "", variety: "", availableDate: jstDate(2), region: "",
  quantity: "", unit: "kg", unitPrice: "", handoverPlace: DEMO_PLACE, handoverStart: "10:00", handoverEnd: "11:00",
  minQuantity: "1", step: "1", handoverFee: "0", irregularReason: "",
});

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

// 編集用の合言葉はこのタブの間だけ保持する（コードや画面の外には書き出さない）
const PASS_KEY = "ai-tiiki:edit-passphrase";
function loadPassphrase(): string {
  try {
    return sessionStorage.getItem(PASS_KEY) ?? "";
  } catch {
    return "";
  }
}
function savePassphrase(v: string) {
  try {
    if (v) sessionStorage.setItem(PASS_KEY, v);
    else sessionStorage.removeItem(PASS_KEY);
  } catch {}
}

async function send(url: string, method: string, body: unknown, passphrase: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "X-Edit-Passphrase": encodeURIComponent(passphrase) },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? { ok: true } : { ok: false, error: d.error ?? "保存できませんでした" };
  } catch {
    return { ok: false, error: "通信に失敗しました。もう一度お試しください" };
  }
}

export default function ProducerPage() {
  const [listings, setListings] = useState<SupplyListing[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [form, setForm] = useState<Form>(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [passphrase, setPassphrase] = useState(loadPassphrase);
  const updatePassphrase = (v: string) => {
    setPassphrase(v);
    savePassphrase(v);
  };

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/listings", { cache: "no-store" });
      const d = await r.json();
      setListings(d.listings);
      setProducers(d.producers);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // 同じ名前の生産者がいるときは ID の末尾で見分けられるようにする
  const producerLabel = (p: Producer) =>
    producers.filter((x) => x.name === p.name).length > 1 ? `${p.name}（ID …${p.id.slice(-4)}）` : p.name;

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    const { producerId, producerName, ...rest } = form;
    const res = await send("/api/listings", "POST", {
      ...(producerId ? { producerId } : { producerName }),
      ...rest,
      irregularReason: rest.irregularReason || null,
    }, passphrase);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? null);
      return;
    }
    const name = producerId ? producers.find((p) => p.id === producerId)?.name : producerName;
    setCreated(`${name}：${form.item}${form.variety ? `（${form.variety}）` : ""} ${form.quantity}${form.unit} を登録しました`);
    setForm(initialForm());
    reload();
  }

  const places = [...new Set([DEMO_PLACE, ...listings.map((l) => l.handoverPlace)])];

  const unitRule = `最低${form.minQuantity || "—"}${form.unit}・${form.step || "—"}${form.unit}刻み・受渡手数料${form.handoverFee || 0}円・${form.irregularReason || "通常品"}`;

  return (
    <div className="page grower-page">
      <header className="page-head">
        <p className="page-role grower"><Icon name="box" />生産者の方</p>
        <h1>販売する野菜を登録・変更する</h1>
        <p className="lead">
          今回販売に回せる量（既存の注文分を除いた量）を登録します。仕入れ案に使われただけでは数量は減りません。
        </p>
        <button
          type="button"
          className="ghost"
          style={{ marginTop: 8, paddingLeft: 0 }}
          onClick={() => document.getElementById("new-listing")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          新しく出品を登録する<Icon name="chevronDown" size={18} />
        </button>
      </header>

      <section className="passphrase-box" aria-labelledby="pass-title">
        <label className="field">
          <span className="label" id="pass-title"><Icon name="edit" size={18} />編集用の合言葉</span>
          <input
            type="password"
            autoComplete="off"
            value={passphrase}
            onChange={(e) => updatePassphrase(e.target.value)}
            placeholder="登録・数量変更・公開停止に必要です"
          />
        </label>
        <p className="hint">見るだけなら不要です。合言葉はこのタブを閉じると消えます。</p>
      </section>

      <section aria-labelledby="list-title">
        <h2 id="list-title" className="list-title">出品中の野菜</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          数量の変更・公開停止をすると、飲食店に表示中の仕入れ案は無効になり、再計算が必要になります。
        </p>
        {loadError && <div className="alert bad"><Icon name="alert" />出品を読み込めませんでした。再読み込みしてください。</div>}
        <ul className="listing-list">
          {listings.map((l) => <ListingCard key={l.id} listing={l} onChanged={reload} passphrase={passphrase} />)}
        </ul>
        {!loadError && listings.length === 0 && <p className="muted">まだ出品はありません。</p>}
      </section>

      <form className="qform" onSubmit={register} id="new-listing" style={{ marginTop: 48, scrollMarginTop: 72 }}>
        <h2 className="list-title">新しく出品を登録する</h2>

        <section className="q" aria-labelledby="g1">
          <h3 className="q-title" id="g1"><span className="q-no">1</span>誰が、何を？<span className="req">必須</span></h3>
          <label className="field">
            <span className="label">生産者</span>
            <select value={form.producerId} onChange={(e) => set("producerId", e.target.value)} aria-required="true">
              <option value="">新しい生産者を登録</option>
              {producers.map((p) => <option key={p.id} value={p.id}>{producerLabel(p)}</option>)}
            </select>
          </label>
          {!form.producerId && (
            <label className="field">
              <span className="label">生産者名</span>
              <input value={form.producerName} onChange={(e) => set("producerName", e.target.value)} maxLength={30} placeholder="例：D農家" aria-required="true" />
            </label>
          )}
          <div className="row">
            <label className="field">
              <span className="label">品目</span>
              <input value={form.item} onChange={(e) => set("item", e.target.value)} maxLength={30} placeholder="例：トマト" aria-required="true" />
            </label>
            <label className="field">
              <span className="label">品種<span className="opt">任意</span></span>
              <input value={form.variety} onChange={(e) => set("variety", e.target.value)} maxLength={30} placeholder="例：桃太郎" />
            </label>
          </div>
        </section>

        <section className="q" aria-labelledby="g2">
          <h3 className="q-title" id="g2"><span className="q-no">2</span>どれだけ、いくらで？<span className="req">必須</span></h3>
          <div className="row">
            <label className="field">
              <span className="label">販売可能量</span>
              <input type="number" inputMode="numeric" min={0} step={1} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="例：5" aria-required="true" />
            </label>
            <label className="field">
              <span className="label">単位</span>
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)} aria-required="true">
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="label">税込単価</span>
            <span className="with-unit">
              <input type="number" inputMode="numeric" min={0} step={1} value={form.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} placeholder="例：600" aria-required="true" />
              <em>円/{form.unit}</em>
            </span>
          </label>
        </section>

        <section className="q" aria-labelledby="g3">
          <h3 className="q-title" id="g3"><span className="q-no">3</span>いつ、どこで渡す？<span className="req">必須</span></h3>
          <div className="row">
            <label className="field">
              <span className="label">販売可能日</span>
              <input type="date" min={jstDate()} value={form.availableDate} onChange={(e) => set("availableDate", e.target.value)} aria-required="true" />
            </label>
            <label className="field">
              <span className="label">地域</span>
              <select value={form.region} onChange={(e) => set("region", e.target.value)} aria-required="true">
                <option value="">選択</option>
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="label">受渡場所</span>
            <input list="places" value={form.handoverPlace} onChange={(e) => set("handoverPlace", e.target.value)} maxLength={50} aria-required="true" />
            <datalist id="places">{places.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <div className="row">
            <label className="field">
              <span className="label">受渡開始</span>
              <input type="time" aria-label="受渡開始" value={form.handoverStart} onChange={(e) => set("handoverStart", e.target.value)} aria-required="true" />
            </label>
            <label className="field">
              <span className="label">受渡終了</span>
              <input type="time" aria-label="受渡終了" value={form.handoverEnd} onChange={(e) => set("handoverEnd", e.target.value)} aria-required="true" />
            </label>
          </div>
        </section>

        <details className="more">
          <summary>
            <span className="more-title">販売の単位・手数料・規格外</span>
            <span className="more-value is-set">{unitRule}</span>
            <Icon name="chevronDown" className="chev" />
          </summary>
          <div className="more-body">
            <div className="row">
              <label className="field">
                <span className="label">最低販売量</span>
                <span className="with-unit">
                  <input type="number" inputMode="numeric" min={1} step={1} value={form.minQuantity} onChange={(e) => set("minQuantity", e.target.value)} aria-required="true" />
                  <em>{form.unit}</em>
                </span>
              </label>
              <label className="field">
                <span className="label">販売刻み</span>
                <span className="with-unit">
                  <input type="number" inputMode="numeric" min={1} step={1} value={form.step} onChange={(e) => set("step", e.target.value)} aria-required="true" />
                  <em>{form.unit}</em>
                </span>
              </label>
            </div>
            <span className="hint">配分は「最低販売量」から「販売刻み」ごとに行います（例：最低2kg・2kg刻みなら 2kg・4kg・6kg…）</span>
            <div className="row">
              <label className="field">
                <span className="label">受渡手数料</span>
                <span className="with-unit">
                  <input type="number" inputMode="numeric" min={0} step={1} value={form.handoverFee} onChange={(e) => set("handoverFee", e.target.value)} aria-required="true" />
                  <em>円</em>
                </span>
              </label>
              <label className="field">
                <span className="label">規格外・余剰</span>
                <select value={form.irregularReason} onChange={(e) => set("irregularReason", e.target.value)} aria-required="true">
                  <option value="">通常品</option>
                  {IRREGULAR_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
            </div>
          </div>
        </details>

        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
        {created && <div className="alert ok" role="status"><Icon name="check" />{created}。飲食店への仕入れ案に使われます。</div>}

        <button type="submit" className="primary large block" disabled={busy} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />登録中…</> : "登録する"}
        </button>
      </form>

      <a className="text-link" href="#/restaurant">飲食店の仕入れ案の画面へ<Icon name="chevronRight" size={18} /></a>
    </div>
  );
}

function ListingCard({ listing: l, onChanged, passphrase }: { listing: SupplyListing; onChanged: () => void; passphrase: string }) {
  const [qty, setQty] = useState(String(l.quantity));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => setQty(String(l.quantity)), [l.quantity]);

  async function patch(body: { quantity?: number | string; isPublic?: boolean }, done: string) {
    setBusy(true);
    setMsg(null);
    const res = await send(`/api/listings/${encodeURIComponent(l.id)}`, "PATCH", body, passphrase);
    setBusy(false);
    setMsg(res.ok ? { tone: "ok", text: done } : { tone: "bad", text: res.error ?? "保存できませんでした" });
    if (res.ok) onChanged();
  }

  const qtyId = `qty-${l.id}`;
  return (
    <li className={`listing ${l.isPublic ? "" : "paused"}`}>
      <div className="listing-top">
        <div>
          <div className="listing-item">{l.item}{l.variety && `（${l.variety}）`}</div>
          <div className="listing-producer">{l.producerName}</div>
        </div>
        <div className="listing-stock">
          <span className="figure stock">{l.quantity}<small>{l.unit}</small></span>
          <div className={`listing-state ${l.isPublic ? "on" : "off"}`}>
            <Icon name={l.isPublic ? "check" : "pause"} size={16} />
            {l.isPublic ? "公開中" : "公開停止中"}
          </div>
        </div>
      </div>
      <div className="listing-meta">
        <span>{yen(l.unitPrice)}/{l.unit}（税込）・{formatDateJa(l.availableDate)} {l.handoverStart}〜{l.handoverEnd}・{l.handoverPlace}</span>
        <span>{l.region}・最低{l.minQuantity}{l.unit}・{l.step}{l.unit}刻み・受渡手数料{yen(l.handoverFee)}</span>
        {l.irregularReason && <span><span className="tag irregular">規格外：{l.irregularReason}</span></span>}
      </div>

      <div className="qty-editor">
        <label className="field" htmlFor={qtyId}>
          <span className="label">販売可能量を変更</span>
          <span className="with-unit">
            <input id={qtyId} type="number" inputMode="numeric" min={0} step={1} value={qty} aria-label={`${l.producerName}の販売可能量`} onChange={(e) => setQty(e.target.value)} />
            <em>{l.unit}</em>
          </span>
        </label>
        <button className="primary" onClick={() => patch({ quantity: qty }, `数量を${qty}${l.unit}に変更しました`)} disabled={busy || qty === String(l.quantity)} aria-busy={busy}>
          数量を変更
        </button>
      </div>
      {msg && <div className={`alert ${msg.tone}`} role="status"><Icon name={msg.tone === "ok" ? "check" : "alert"} />{msg.text}</div>}

      <div className="listing-foot">
        <span className="hint">{l.isPublic ? "仕入れ案に使われます" : "仕入れ案に使われません"}</span>
        <button className={l.isPublic ? "danger-ghost" : "secondary"} onClick={() => patch({ isPublic: !l.isPublic }, l.isPublic ? "公開を止めました" : "公開を再開しました")} disabled={busy}>
          <Icon name={l.isPublic ? "pause" : "play"} size={16} />
          {l.isPublic ? "公開を止める" : "公開を再開"}
        </button>
      </div>
    </li>
  );
}
