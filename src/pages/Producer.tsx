import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { Me } from "../App";
import { formatJstDateTime, jstTimeOf } from "../lib/dates.js";
import { Icon } from "../components/Icon";
import { useSession } from "../routes/session";
import { supplyAnchor } from "./daily/ListingsSummary";
import { PickupSetup, usePickupData } from "./daily/PickupPoints";

// 生産者本人の供給一覧。主な操作は「数量を変更」「価格を変更」と「公開停止／再開」。
// どの変更でも version が上がり、その在庫を使った仕入れ案・相談は「条件が変わりました」になる（サーバーの既存の判定）。
// 権限（本人の供給か）と競合（version）はサーバーで確認する。

type Supply = {
  id: string;
  item: { id: string; name: string };
  variety: { id: string; name: string };
  grade: "regular" | "irregular";
  irregularReason: string | null;
  originPrefecture: string;
  availableKg: number;
  priceYenPerKg: number;
  minKg: number;
  slot: { id: string; label: string; placeName: string; startAt: string; endAt: string };
  published: boolean;
  version: number;
  updatedAt: string;
};
type Slot = { id: string; label: string; placeId?: string; placeName: string; placeAddress?: string; placeKind?: string | null; startAt: string; endAt: string; participationConfirmed: boolean };
type Item = { id: string; name: string; varieties: { id: string; name: string }[] };
type Data = { supplies: Supply[]; slots: Slot[]; items: Item[]; prefectures: string[] };

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

async function send(url: string, method: string, body: unknown) {
  try {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d as { error?: string; supply?: Supply; before?: { availableKg: number; priceYenPerKg: number; published: boolean } } };
  } catch {
    return { ok: false, status: 0, data: { error: "通信に失敗しました。もう一度お試しください" } };
  }
}

export default function ProducerPage({ me }: { me: Me }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 更新結果（何が変わったか）。一覧を読み直してもカードの下に残す
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);

  // 一覧の読み込みは最後に始めたものだけを反映する（更新の前に始まった読み込みが、後から古い数量で上書きしないように）
  const loadSeq = useRef(0);
  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const r = await fetch("/api/supplies", { cache: "no-store" });
      const d = await r.json();
      if (seq !== loadSeq.current) return;
      if (!r.ok) throw Object.assign(new Error(typeof d?.error === "string" ? d.error : ""), { name: "LoadError" });
      setData(d);
      setLoadError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoadError(e instanceof Error && e.name === "LoadError" && e.message ? e.message : "出品を読み込めませんでした。画面を再読み込みしてください。");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // マイページの「編集する」から来たとき（#supply-…）：その商品のところまで移動し、枠で囲んで分かるようにする。
  // 数量の欄にはフォーカスしない（スマートフォンでキーボードが開いて商品が隠れないように）
  const { hash } = useLocation();
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!data || !hash.startsWith("#supply-")) return;
    const id = decodeURIComponent(hash.slice("#supply-".length));
    const el = document.getElementById(supplyAnchor(id));
    if (!el) return;
    setTarget(id);
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView?.({ block: "start", behavior: smooth ? "smooth" : "auto" });
    el.focus({ preventScroll: true });
  }, [data !== null, hash]); // 読み込みが終わったとき・行き先が変わったときだけ（一覧の読み直しでは動かさない）

  // これからの受け渡しの回（受け渡しの場所と日時）。はじめての出品で1つもなければ、場所を聞く
  const { appMode, demoNow } = useSession();
  const general = appMode === "general";
  const now = demoNow ? new Date(demoNow) : new Date();
  const upcoming = (data?.slots ?? []).filter((s) => new Date(s.startAt).getTime() > now.getTime()).sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <main className="screen">
      <h1 className="display">今日出せる量</h1>

      {loadError && <div className="alert bad" role="alert"><Icon name="alert" />{loadError}</div>}
      {data === null && !loadError && <p className="muted">読み込み中…</p>}
      <ul className="supply-list" aria-label="供給一覧">
        {data?.supplies.map((s) => (
          <SupplyCard
            key={`${s.id}:${s.version}`}
            supply={s}
            targeted={target === s.id}
            done={done?.id === s.id ? done.text : null}
            onChanged={(text, updated) => {
              setDone(text ? { id: s.id, text } : null);
              // 更新 API が返した最新の供給をすぐ表示に反映し（古い数量が見えないように）、その後で一覧を読み直す
              if (updated) setData((d) => d && { ...d, supplies: d.supplies.map((x) => (x.id === updated.id ? updated : x)) });
              reload();
            }}
          />
        ))}
      </ul>
      {data && data.supplies.length === 0 && <p className="muted">まだ供給は登録されていません。</p>}

      {/* はじめての出品で、まだ渡せる場所がない（一般向けの環境）：その場で「普段、野菜をどこで渡せますか？」を1回だけ聞いてから出品へ進む */}
      {data && general && upcoming.length === 0 && <FirstPlaceSetup onDone={reload} />}
      {data && (!general || upcoming.length > 0) && <NewSupply data={{ ...data, slots: upcoming }} defaultOrigin={me.producer?.originPrefecture ?? ""} onCreated={reload} openFirst={data.supplies.length === 0} />}
    </main>
  );
}

function SupplyCard({ supply: s, targeted = false, done, onChanged }: { supply: Supply; targeted?: boolean; done: string | null; onChanged: (text?: string, updated?: Supply) => void }) {
  const [kg, setKg] = useState(String(s.availableKg));
  const [price, setPrice] = useState(String(s.priceYenPerKg));
  const [editPrice, setEditPrice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string; conflict?: boolean } | null>(null);

  async function patch(body: { availableKg?: number | string; priceYenPerKg?: number | string; published?: boolean }) {
    setBusy(true);
    setMsg(null);
    // 画面を開いた時点の version を送り、別の更新と競合したら上書きしない
    const r = await send(`/api/supplies/${encodeURIComponent(s.id)}`, "PATCH", { version: s.version, ...body });
    setBusy(false);
    if (!r.ok) {
      setMsg({ tone: "bad", text: r.data.error ?? "保存できませんでした", conflict: r.status === 409 });
      return;
    }
    const before = r.data.before!;
    const after = r.data.supply!;
    const text = body.availableKg !== undefined
      ? `${before.availableKg}kg → ${after.availableKg}kg に更新しました`
      : body.priceYenPerKg !== undefined
        ? `${yen(before.priceYenPerKg)}/kg → ${yen(after.priceYenPerKg)}/kg に変更しました`
        : after.published ? "公開を再開しました（仕入れ案に使われます）" : "公開を止めました（仕入れ案に使われません）";
    onChanged(text, after);
  }

  // − / ＋ は数量を 1kg ずつ動かすだけ。送るのは主ボタンを押したときの確定値（0〜100kg）
  const inputRef = useRef<HTMLInputElement>(null);
  const step = (d: number) => {
    const cur = Number.isInteger(Number(kg)) && kg !== "" ? Number(kg) : s.availableKg;
    const next = Math.min(100, Math.max(0, cur + d));
    setKg(String(next));
    // 数字が切り替わったことが分かる、ごく短い動き（動きを減らす設定では行わない）
    if (next !== cur && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      inputRef.current?.animate([{ transform: `translateY(${d > 0 ? 6 : -6}px)`, opacity: 0.35 }, { transform: "none", opacity: 1 }], { duration: 180, easing: "ease-out" });
    }
  };
  const nextKg = Number.isFinite(Number(kg)) && kg !== "" ? Math.max(0, Number(kg)) : s.availableKg;
  const scale = Math.max(s.availableKg, nextKg, 1);
  const kgId = `kg-${s.id}`;
  const changed = kg !== String(s.availableKg);
  return (
    <li id={supplyAnchor(s.id)} tabIndex={-1} className={`supply listing ${s.published ? "" : "paused"} ${targeted ? "targeted" : ""}`} aria-label={targeted ? `編集する商品：${s.item.name}` : undefined}>
      <div className="supply-head">
        <span className="supply-icon" aria-hidden="true"><Icon name="leaf" size={24} /></span>
        <h2 className="supply-title">{s.item.name}<small>{s.originPrefecture}産・{s.grade === "irregular" ? (s.irregularReason ? `規格外（${s.irregularReason}）` : "規格外") : "通常品"}</small></h2>
        
      </div>
      {done && <p className="supply-updated" role="status"><Icon name="check" size={22} strokeWidth={2.4} /><strong>{done}</strong></p>}

      {/* 現在 → 変更後（いちばん大きい数字）→ 更新 */}
      <form className="qty-tool" onSubmit={(e) => { e.preventDefault(); patch({ availableKg: kg }); }}>
        {/* 数字＋±＋量のバーで1つの道具。灰色のバー＝現在、オレンジのバー＝変更後（上の大きな数字） */}
        <div className={`qty-panel ${changed ? "changed" : ""}`}>
          <div className="qty-top">
            <label className="qty-next" htmlFor={kgId}>
              <span className="qty-label">残りの量</span>
              <span className="with-unit">
                <input ref={inputRef} id={kgId} type="number" inputMode="numeric" min={0} max={100} step={1} value={kg} onChange={(e) => setKg(e.target.value)} aria-label={`${s.item.name}の残りの量`} />
                <em>kg</em>
              </span>
            </label>
            <div className="stepper">
              <button type="button" onClick={() => step(-1)} aria-label="1kg減らす" disabled={busy}><Icon name="minus" size={28} strokeWidth={2.4} /></button>
              <button type="button" onClick={() => step(1)} aria-label="1kg増やす" disabled={busy}><Icon name="plus" size={28} strokeWidth={2.4} /></button>
            </div>
          </div>
          <div className="qty-bars">
            <span className="qty-bar-label">現在</span>
            <span className="qty-track" aria-hidden="true"><i className="qty-bar now" style={{ width: `${(s.availableKg / scale) * 100}%` }} /></span>
            <span className="qty-bar-val num current-kg">{s.availableKg}kg</span>
            <span aria-hidden="true" />
            <span className="qty-track" aria-hidden="true"><i className="qty-bar next" style={{ width: `${(nextKg / scale) * 100}%` }} /></span>
            <span aria-hidden="true" />
          </div>
        </div>
        <button type="submit" className="btn-primary btn-block" disabled={busy || !changed} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />変更しています…</> : changed ? `${kg || "?"}kgに変更する` : "変更する"}
        </button>
      </form>
      {msg && (
        <div className={`alert ${msg.tone}`} role="alert">
          <Icon name="alert" />
          <div>
            {msg.text}
            {msg.conflict && <button type="button" className="btn-secondary" style={{ marginTop: 10 }} onClick={() => onChanged()}><Icon name="refresh" size={18} />最新の情報を読み込む</button>}
          </div>
        </div>
      )}

      {editPrice ? (
        <form className="price-tool" onSubmit={(e) => { e.preventDefault(); patch({ priceYenPerKg: price }); }}>
          <label className="field">
            <span className="label">価格（1kgあたり・税込）</span>
            <span className="with-unit"><input type="number" inputMode="numeric" min={1} step={1} value={price} onChange={(e) => setPrice(e.target.value)} aria-label={`${s.item.name}の新しい価格`} /><em>円/kg</em></span>
          </label>
          <p className="hint">価格を変えると、この在庫を使った仕入れ案・仕入れ相談は「条件が変わりました」になり、飲食店は計算し直してから相談し直します。</p>
          <div className="bar-pair">
            <button type="submit" className="btn-primary" disabled={busy || price === String(s.priceYenPerKg) || price === ""} aria-busy={busy}>価格を変更する</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setEditPrice(false); setPrice(String(s.priceYenPerKg)); }}>やめる</button>
          </div>
        </form>
      ) : null}
      <p className="supply-facts">
        <span><Icon name="yen" size={20} />{yen(s.priceYenPerKg)}/kg{!editPrice && <button type="button" className="text-btn price-edit" onClick={() => setEditPrice(true)} aria-label={`${s.item.name}の価格を変更する`}><Icon name="edit" size={18} />変更</button>}</span>
        <span><Icon name="calendar" size={20} />{formatJstDateTime(s.slot.startAt)}〜{jstTimeOf(s.slot.endAt)}</span>
        <span><Icon name="pin" size={20} />{s.slot.placeName}</span>
      </p>
      <div className="publish-row">
        {/* 公開中で 0kg は「売り切れ」（マイページと同じ言葉・見た目）。仕入れ案の候補にはならない（公開の状態はそのまま） */}
        {s.published && s.availableKg === 0
          ? <p className="publish-state soldout"><b>売り切れ</b>仕入れ案には使われません。量を増やすと、また使われます</p>
          : <p className={`publish-state ${s.published ? "on" : "off"}`}><b>{s.published ? "公開中" : "公開を停止中"}</b>{s.published ? "飲食店に表示されています" : "飲食店には表示されません"}</p>}
        <button type="button" className="btn-secondary publish-btn" onClick={() => patch({ published: !s.published })} disabled={busy}>
          {s.published ? "公開を止める" : "公開を再開する"}
        </button>
      </div>
    </li>
  );
}

type NewForm = {
  itemId: string; varietyId: string; grade: "" | "regular" | "irregular"; irregularReason: string; originPrefecture: string;
  availableKg: string; priceYenPerKg: string; minKg: string; slotId: string; published: "" | "yes" | "no";
};

/** はじめての出品の前に、普段の受け渡しの場所を1回だけ聞く */
function FirstPlaceSetup({ onDone }: { onDone: () => void }) {
  const { data, error } = usePickupData();
  return (
    <section className="first-place" aria-label="はじめての出品の前に">
      <p className="first-place-lead">はじめての出品です。最初に一度だけ教えてください。</p>
      {error && <p className="alert bad" role="alert">{error}</p>}
      {!data && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {data && <PickupSetup candidates={data.candidates} onDone={onDone} />}
    </section>
  );
}

/**
 * 受け渡し：いつもの場所と、いちばん近い日時を最初から選んでおく（毎回入力させない）。必要なときだけ「変更」。
 * slots はこれからの回（日時の早い順）
 */
function PickupChoice({ slots, value, onChange }: { slots: Slot[]; value: string; onChange: (slotId: string) => void }) {
  const [changing, setChanging] = useState(false);
  const current = slots.find((s) => s.id === value) ?? slots[0];
  if (!current) return null;
  const keyOf = (s: Slot) => s.placeId ?? s.placeName;
  const places = slots.filter((s, i) => slots.findIndex((x) => keyOf(x) === keyOf(s)) === i);
  const dates = slots.filter((s) => keyOf(s) === keyOf(current)).slice(0, 6);
  const when = (s: Slot) => `${formatJstDateTime(s.startAt)}〜${jstTimeOf(s.endAt)}`;
  return (
    <div className="field pickup-choice" data-field="slotId">
      <span className="label">受け渡し</span>
      <div className="pickup-current">
        <b className="pickup-current-place"><Icon name="pin" size={20} />いつもの{current.placeName}<Icon name="check" size={20} strokeWidth={2.6} /></b>
        <span className="pickup-current-when">{when(current)}</span>
        {!changing && (places.length > 1 || dates.length > 1) && <button type="button" className="text-btn" onClick={() => setChanging(true)}>変更</button>}
      </div>
      {changing && (
        <div className="pickup-change">
          {places.length > 1 && (
            <div className="pickup-options" role="group" aria-label="場所">
              {places.map((p) => <button key={keyOf(p)} type="button" className={`pickup-option ${keyOf(p) === keyOf(current) ? "on" : ""}`} aria-pressed={keyOf(p) === keyOf(current)} onClick={() => onChange(p.id)}>{p.placeName}</button>)}
            </div>
          )}
          <div className="pickup-options" role="group" aria-label="日時">
            {dates.map((s) => <button key={s.id} type="button" className={`pickup-option ${s.id === current.id ? "on" : ""}`} aria-pressed={s.id === current.id} onClick={() => onChange(s.id)}>{when(s)}</button>)}
          </div>
          <button type="button" className="btn-secondary btn-block" onClick={() => setChanging(false)}>これにする</button>
        </div>
      )}
    </div>
  );
}

function NewSupply({ data, defaultOrigin, onCreated, openFirst = false }: { data: Data; defaultOrigin: string; onCreated: () => void; openFirst?: boolean }) {
  const empty: NewForm = { itemId: "", varietyId: "", grade: "regular", irregularReason: "", originPrefecture: defaultOrigin, availableKg: "", priceYenPerKg: "", minKg: "1", slotId: "", published: "" };
  const [f, setF] = useState<NewForm>(empty);
  // 受け渡しは、いつもの場所のいちばん近い日時を最初から選んでおく
  const defaultSlot = data.slots[0]?.id ?? "";
  useEffect(() => {
    if (!f.slotId || !data.slots.some((s) => s.id === f.slotId)) setF((x) => ({ ...x, slotId: defaultSlot }));
  }, [f.slotId, data.slots, defaultSlot]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const set = <K extends keyof NewForm>(k: K, v: NewForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const item = data.items.find((i) => i.id === f.itemId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await send("/api/supplies", "POST", {
      ...f, irregularReason: f.grade === "irregular" ? f.irregularReason : null, grade: f.grade || null,
      published: f.published === "" ? null : f.published === "yes",
    });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "bad", text: r.data.error ?? "登録できませんでした" });
    setMsg({ tone: "ok", text: `${r.data.supply!.item.name} ${r.data.supply!.availableKg}kg を登録しました` });
    setF(empty);
    onCreated();
  }

  return (
    <details className="more" open={openFirst || undefined}>
      <summary>
        <span>新しい在庫を登録する</span>
        <Icon name="chevronDown" />
      </summary>
      <form className="more-body" onSubmit={submit}>
        <div className="row2">
          <label className="field">
            <span className="label">品目</span>
            <select
              value={f.itemId}
              onChange={(e) => {
                // 品種が1つだけの品目は、その品種を自動で選ぶ（選択欄は出さない）
                const next = data.items.find((i) => i.id === e.target.value);
                setF((x) => ({ ...x, itemId: e.target.value, varietyId: next && next.varieties.length === 1 ? next.varieties[0].id : "" }));
              }}
              aria-required="true"
            >
              <option value="">選択</option>
              {data.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          {item && item.varieties.length > 1 && (
            <label className="field">
              <span className="label">品種</span>
              <select value={f.varietyId} onChange={(e) => set("varietyId", e.target.value)} aria-required="true">
                <option value="">選択</option>
                {item.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="row2">
          <label className="field">
            <span className="label">規格</span>
            <select value={f.grade} onChange={(e) => set("grade", e.target.value as NewForm["grade"])}>
              <option value="regular">通常品</option>
              <option value="irregular">規格外</option>
            </select>
          </label>
          <label className="field">
            <span className="label">産地</span>
            <select value={f.originPrefecture} onChange={(e) => set("originPrefecture", e.target.value)} aria-required="true">
              <option value="">選択</option>
              {data.prefectures.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
        </div>
        {f.grade === "irregular" && (
          <label className="field">
            <span className="label">規格外の理由 <span className="tag-opt">任意</span></span>
            <input value={f.irregularReason} onChange={(e) => set("irregularReason", e.target.value)} maxLength={30} placeholder="例：形の不揃い" />
          </label>
        )}
        <div className="row2">
          <label className="field">
            <span className="label">販売できる量</span>
            <span className="with-unit"><input type="number" inputMode="numeric" min={0} max={100} step={1} value={f.availableKg} onChange={(e) => set("availableKg", e.target.value)} /><em>kg</em></span>
          </label>
          <label className="field">
            <span className="label">価格（1kgあたり・税込）</span>
            <span className="with-unit"><input type="number" inputMode="numeric" min={1} step={1} value={f.priceYenPerKg} onChange={(e) => set("priceYenPerKg", e.target.value)} /><em>円/kg</em></span>
          </label>
        </div>
        <label className="field">
          <span className="label">最低販売量</span>
          <span className="with-unit"><input type="number" inputMode="numeric" min={1} max={100} step={1} value={f.minKg} onChange={(e) => set("minKg", e.target.value)} /><em>kg</em></span>
        </label>
        <PickupChoice slots={data.slots} value={f.slotId} onChange={(id) => set("slotId", id)} />
        <div className="field">
          <span className="label" id="pub-title">すぐに公開する？</span>
          <div className="seg" role="radiogroup" aria-labelledby="pub-title">
            <label><input type="radio" name="pub" checked={f.published === "no"} onChange={() => set("published", "no")} />まだ公開しない</label>
            <label><input type="radio" name="pub" checked={f.published === "yes"} onChange={() => set("published", "yes")} />公開する</label>
          </div>
        </div>
        {msg && <div className={`alert ${msg.tone}`} role="status"><Icon name={msg.tone === "ok" ? "check" : "alert"} />{msg.text}</div>}
        <button type="submit" className="btn-primary btn-block" disabled={busy} aria-busy={busy}>登録する</button>
      </form>
    </details>
  );
}
