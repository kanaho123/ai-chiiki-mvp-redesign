import { useCallback, useEffect, useState } from "react";
import type { SupplyListing } from "../lib/allocate.js";
import { DEMO_PLACE, IRREGULAR_REASONS, REGIONS, UNITS } from "../lib/constants.js";
import { formatDateJa, jstDate } from "../lib/dates.js";

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

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
    });
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

  return (
    <>
      <h1>販売できるものを登録</h1>
      <p className="muted small">
        登録するのは、既存の注文分を除いて今回販売に回せる量です。仕入れ案に使われただけでは数量は減りません。
      </p>

      <section className="card">
        <form className="form" onSubmit={register}>
          <div className="stack">
            <label className="field">
              <span>生産者</span>
              <select value={form.producerId} onChange={(e) => set("producerId", e.target.value)}>
                <option value="">新しい生産者を登録</option>
                {producers.map((p) => <option key={p.id} value={p.id}>{producerLabel(p)}</option>)}
              </select>
            </label>
            {!form.producerId && (
              <label className="field">
                <span>生産者名</span>
                <input value={form.producerName} onChange={(e) => set("producerName", e.target.value)} maxLength={30} placeholder="例：D農家" />
              </label>
            )}
          </div>

          <div className="row">
            <label className="field">
              <span>品目</span>
              <input value={form.item} onChange={(e) => set("item", e.target.value)} maxLength={30} placeholder="例：トマト" />
            </label>
            <label className="field">
              <span>品種（任意）</span>
              <input value={form.variety} onChange={(e) => set("variety", e.target.value)} maxLength={30} placeholder="例：桃太郎" />
            </label>
          </div>

          <div className="row">
            <label className="field">
              <span>販売可能日（受渡日）</span>
              <input type="date" min={jstDate()} value={form.availableDate} onChange={(e) => set("availableDate", e.target.value)} />
            </label>
            <label className="field">
              <span>地域</span>
              <select value={form.region} onChange={(e) => set("region", e.target.value)}>
                <option value="">選択</option>
                {REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>

          <div className="row">
            <label className="field">
              <span>販売可能量</span>
              <input type="number" inputMode="numeric" min={0} step={1} value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </label>
            <label className="field">
              <span>単位</span>
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
            </label>
          </div>

          <label className="field">
            <span>税込単価</span>
            <div className="with-unit">
              <input type="number" inputMode="numeric" min={0} step={1} value={form.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} />
              <em>円/{form.unit}</em>
            </div>
          </label>

          <label className="field">
            <span>受渡場所</span>
            <input list="places" value={form.handoverPlace} onChange={(e) => set("handoverPlace", e.target.value)} maxLength={50} />
            <datalist id="places">{places.map((p) => <option key={p} value={p} />)}</datalist>
          </label>

          <div className="field">
            <span>受渡時間</span>
            <div className="row">
              <input type="time" aria-label="受渡開始" value={form.handoverStart} onChange={(e) => set("handoverStart", e.target.value)} />
              <input type="time" aria-label="受渡終了" value={form.handoverEnd} onChange={(e) => set("handoverEnd", e.target.value)} />
            </div>
          </div>

          <div className="row">
            <label className="field">
              <span>最低販売量</span>
              <div className="with-unit">
                <input type="number" inputMode="numeric" min={1} step={1} value={form.minQuantity} onChange={(e) => set("minQuantity", e.target.value)} />
                <em>{form.unit}</em>
              </div>
            </label>
            <label className="field">
              <span>販売刻み</span>
              <div className="with-unit">
                <input type="number" inputMode="numeric" min={1} step={1} value={form.step} onChange={(e) => set("step", e.target.value)} />
                <em>{form.unit}</em>
              </div>
            </label>
          </div>
          <small className="muted">配分は「最低販売量」から「販売刻み」ごとに行います（例：最低2kg・2kg刻みなら 2kg・4kg・6kg…）</small>

          <div className="row">
            <label className="field">
              <span>受渡手数料</span>
              <div className="with-unit">
                <input type="number" inputMode="numeric" min={0} step={1} value={form.handoverFee} onChange={(e) => set("handoverFee", e.target.value)} />
                <em>円</em>
              </div>
            </label>
            <label className="field">
              <span>規格外・余剰</span>
              <select value={form.irregularReason} onChange={(e) => set("irregularReason", e.target.value)}>
                <option value="">通常品</option>
                {IRREGULAR_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
          </div>

          {error && <div className="alert bad" role="alert">{error}</div>}
          {created && <div className="alert ok" role="status">{created}。飲食店への仕入れ案に使われます。</div>}

          <button type="submit" className="primary" disabled={busy}>{busy ? "登録中…" : "登録する"}</button>
        </form>
      </section>

      <h2>登録済みの出品</h2>
      <p className="muted small">
        数量の変更・公開停止をすると、飲食店に表示中の仕入れ案は無効になり、再計算が必要になります。
      </p>
      {loadError && <div className="alert bad">出品を読み込めませんでした。再読み込みしてください。</div>}
      <div className="stack">
        {listings.map((l) => <ListingCard key={l.id} listing={l} onChanged={reload} />)}
        {!loadError && listings.length === 0 && <p className="muted">まだ出品はありません。</p>}
      </div>

      <p className="small"><a href="#/restaurant">飲食店の仕入れ案の画面へ</a></p>
    </>
  );
}

function ListingCard({ listing: l, onChanged }: { listing: SupplyListing; onChanged: () => void }) {
  const [qty, setQty] = useState(String(l.quantity));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => setQty(String(l.quantity)), [l.quantity]);

  async function patch(body: { quantity?: number | string; isPublic?: boolean }, done: string) {
    setBusy(true);
    setMsg(null);
    const res = await send(`/api/listings/${encodeURIComponent(l.id)}`, "PATCH", body);
    setBusy(false);
    setMsg(res.ok ? { tone: "ok", text: done } : { tone: "bad", text: res.error ?? "保存できませんでした" });
    if (res.ok) onChanged();
  }

  return (
    <div className="card" style={l.isPublic ? undefined : { opacity: 0.7 }}>
      <div className="listing-head">
        <strong>{l.producerName}：{l.item}{l.variety && `（${l.variety}）`}</strong>
        <span className={l.isPublic ? "tag" : "status-badge"}>{l.isPublic ? "公開中" : "公開停止中"}</span>
      </div>
      <div className="listing-meta">
        {l.quantity}{l.unit}・{yen(l.unitPrice)}/{l.unit}（税込）・{formatDateJa(l.availableDate)} {l.handoverStart}〜{l.handoverEnd}・{l.handoverPlace}
        <br />
        {l.region}・最低{l.minQuantity}{l.unit}・{l.step}{l.unit}刻み・受渡手数料{yen(l.handoverFee)}
        {l.irregularReason && <> ・<span className="tag">規格外：{l.irregularReason}</span></>}
      </div>
      <div className="inline-edit">
        <label className="with-unit">
          <input type="number" inputMode="numeric" min={0} step={1} value={qty} aria-label={`${l.producerName}の販売可能量`} onChange={(e) => setQty(e.target.value)} />
          <em>{l.unit}</em>
        </label>
        <button onClick={() => patch({ quantity: qty }, `数量を${qty}${l.unit}に変更しました`)} disabled={busy || qty === String(l.quantity)}>
          数量を変更
        </button>
        <button onClick={() => patch({ isPublic: !l.isPublic }, l.isPublic ? "公開を止めました" : "公開を再開しました")} disabled={busy}>
          {l.isPublic ? "公開を止める" : "公開を再開"}
        </button>
      </div>
      {msg && <div className={`alert ${msg.tone} small`} role="status" style={{ marginTop: 8 }}>{msg.text}</div>}
    </div>
  );
}
