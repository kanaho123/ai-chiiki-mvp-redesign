import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { Me } from "../App";
import { formatJstDateTime, jstTimeOf } from "../lib/dates.js";
import { Icon } from "../components/Icon";
import { findItemByName, itemKey, ITEM_NAME_MAX, parseItemName } from "../lib/items.js";
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
      {data && (!general || upcoming.length > 0) && <NewSupply data={{ ...data, slots: upcoming }} defaultOrigin={me.producer?.originPrefecture ?? ""} onCreated={reload} openFirst={data.supplies.length === 0} general={general} />}
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

/** 出品の1行（商品ごと）。品目は候補つきの自由入力 */
type SupplyRow = {
  key: number; itemName: string; varietyId: string; grade: "regular" | "irregular"; irregularReason: string;
  availableKg: string; priceYenPerKg: string; minKg: string; status: { tone: "ok" | "bad"; text: string } | null;
};
/** 全行に共通（産地・受け渡し・公開するか） */
type SupplyShared = { originPrefecture: string; slotId: string; published: "" | "yes" | "no" };
const MAX_ROWS = 10;

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

function NewSupply({ data, defaultOrigin, onCreated, openFirst = false, general = false }: { data: Data; defaultOrigin: string; onCreated: () => void; openFirst?: boolean; general?: boolean }) {
  const keyRef = useRef(1);
  const newRow = (): SupplyRow => ({ key: keyRef.current++, itemName: "", varietyId: "", grade: "regular", irregularReason: "", availableKg: "", priceYenPerKg: "", minKg: "1", status: null });
  const [rows, setRows] = useState<SupplyRow[]>(() => [newRow()]);
  const [shared, setShared] = useState<SupplyShared>({ originPrefecture: defaultOrigin, slotId: "", published: "" });
  // 受け渡しは、いつもの場所のいちばん近い日時を最初から選んでおく
  const defaultSlot = data.slots[0]?.id ?? "";
  useEffect(() => {
    if (!shared.slotId || !data.slots.some((s) => s.id === shared.slotId)) setShared((x) => ({ ...x, slotId: defaultSlot }));
  }, [shared.slotId, data.slots, defaultSlot]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const setRow = (key: number, patch: Partial<SupplyRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, status: null } : r)));
  const setShare = <K extends keyof SupplyShared>(k: K, v: SupplyShared[K]) => setShared((x) => ({ ...x, [k]: v }));
  // 入力した品目名が、すでにある品目（照合の鍵が同じ）か。なければ新しい品目
  const knownOf = (r: SupplyRow) => (r.itemName.trim() ? findItemByName(r.itemName, data.items) : null);
  const varietyOf = (r: SupplyRow, known: Item) => r.varietyId || (known.varieties.length === 1 ? known.varieties[0].id : "");
  const dupKey = (r: SupplyRow) => { const known = knownOf(r); return known ? `${known.id}:${varietyOf(r, known)}` : `new:${itemKey(r.itemName)}`; };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    // 送る前に止める：品目が空・品目名の形が違う・品種が未選択・同じ画面の中で同じ品目（品種）が重なっている
    const checked = rows.map((r): SupplyRow => {
      const known = knownOf(r);
      if (!known) {
        const name = parseItemName(r.itemName);
        if (!name.ok) return { ...r, status: { tone: "bad", text: name.error } };
      } else if (known.varieties.length > 1 && !r.varietyId) return { ...r, status: { tone: "bad", text: "品種を選んでください" } };
      return r;
    });
    const counts = new Map<string, number>();
    for (const r of checked) if (!r.status) counts.set(dupKey(r), (counts.get(dupKey(r)) ?? 0) + 1);
    const marked = checked.map((r): SupplyRow => (!r.status && (counts.get(dupKey(r)) ?? 0) > 1 ? { ...r, status: { tone: "bad", text: "同じ品目がほかの行にもあります。1つの行にまとめてください" } } : r));
    if (marked.some((r) => r.status)) {
      setRows(marked);
      setMsg({ tone: "bad", text: "まだ登録していません。理由が出ている行を直してください" });
      return;
    }

    // 1行ずつ、今までの出品の API で登録する（一部だけ失敗しても、行ごとに結果を出す）
    setBusy(true);
    const failed: SupplyRow[] = [];
    const done: string[] = [];
    for (const r of rows) {
      const known = knownOf(r);
      const itemPart = known
        ? { itemId: known.id, varietyId: varietyOf(r, known) || (known.varieties.find((v) => v.name === "指定なし")?.id ?? "") }
        : { itemName: r.itemName };
      const res = await send("/api/supplies", "POST", {
        ...itemPart, grade: r.grade, irregularReason: r.grade === "irregular" ? r.irregularReason : null,
        originPrefecture: shared.originPrefecture, availableKg: r.availableKg, priceYenPerKg: r.priceYenPerKg, minKg: r.minKg,
        slotId: shared.slotId, published: shared.published === "" ? null : shared.published === "yes",
      });
      if (res.ok) done.push(`${res.data.supply!.item.name} ${res.data.supply!.availableKg}kg`);
      else failed.push({ ...r, status: { tone: "bad", text: res.data.error ?? "登録できませんでした" } });
    }
    setBusy(false);
    if (failed.length === 0) {
      setRows([newRow()]);
      setMsg({ tone: "ok", text: done.length === 1 ? `${done[0]} を登録しました` : `${done.length}件を登録しました（${done.join("・")}）` });
    } else {
      setRows(failed); // 登録できた行は消し、できなかった行だけを理由つきで残す
      setMsg({ tone: "bad", text: done.length ? `${done.length}件を登録しました（${done.join("・")}）。${failed.length}件は登録できませんでした。理由が出ている行を確認してください` : "登録できませんでした。理由が出ている行を確認してください" });
    }
    if (done.length) onCreated();
  }

  return (
    <details className="more" open={openFirst || undefined}>
      <summary>
        <span>新しい在庫を登録する</span>
        <Icon name="chevronDown" />
      </summary>
      <form className="more-body" onSubmit={submit}>
        <datalist id="supply-item-options">{data.items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
        {rows.map((r, idx) => {
          const known = knownOf(r);
          const isNew = general && !known && r.itemName.trim() !== "" && parseItemName(r.itemName).ok;
          return (
            <fieldset key={r.key} className={`supply-new-row ${r.status?.tone === "bad" ? "bad" : ""}`} aria-label={`商品 ${idx + 1}`}>
              {rows.length > 1 && (
                <div className="supply-new-row-head">
                  <span className="supply-new-row-title">商品 {idx + 1}</span>
                  <button type="button" className="text-btn" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={busy}>この行を消す</button>
                </div>
              )}
              {/* 品目は長い名前（万願寺とうがらし など）も見えるよう、品種を選ぶときだけ2列にする */}
              <div className={known && known.varieties.length > 1 ? "row2" : "supply-item-line"}>
                <label className="field">
                  <span className="label">品目</span>
                  <input value={r.itemName} onChange={(e) => setRow(r.key, { itemName: e.target.value, varietyId: "" })} list="supply-item-options" maxLength={ITEM_NAME_MAX} placeholder="例：万願寺とうがらし" aria-required="true" autoComplete="off" />
                  {isNew && <span className="hint">新しい品目として登録します</span>}
                </label>
                {known && known.varieties.length > 1 && (
                  <label className="field">
                    <span className="label">品種</span>
                    <select value={r.varietyId} onChange={(e) => setRow(r.key, { varietyId: e.target.value })} aria-required="true">
                      <option value="">選択</option>
                      {known.varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <label className="field">
                <span className="label">規格</span>
                <select value={r.grade} onChange={(e) => setRow(r.key, { grade: e.target.value as SupplyRow["grade"] })}>
                  <option value="regular">通常品</option>
                  <option value="irregular">規格外</option>
                </select>
              </label>
              {r.grade === "irregular" && (
                <label className="field">
                  <span className="label">規格外の理由 <span className="tag-opt">任意</span></span>
                  <input value={r.irregularReason} onChange={(e) => setRow(r.key, { irregularReason: e.target.value })} maxLength={30} placeholder="例：形の不揃い" />
                </label>
              )}
              <div className="row2">
                <label className="field">
                  <span className="label">販売できる量</span>
                  <span className="with-unit"><input type="number" inputMode="numeric" min={0} max={100} step={1} value={r.availableKg} onChange={(e) => setRow(r.key, { availableKg: e.target.value })} /><em>kg</em></span>
                </label>
                <label className="field">
                  <span className="label">価格（1kgあたり・税込）</span>
                  <span className="with-unit"><input type="number" inputMode="numeric" min={1} step={1} value={r.priceYenPerKg} onChange={(e) => setRow(r.key, { priceYenPerKg: e.target.value })} /><em>円/kg</em></span>
                </label>
              </div>
              <label className="field">
                <span className="label">最低販売量</span>
                <span className="with-unit"><input type="number" inputMode="numeric" min={1} max={100} step={1} value={r.minKg} onChange={(e) => setRow(r.key, { minKg: e.target.value })} /><em>kg</em></span>
              </label>
              {r.status && <p className="supply-new-row-status" role="alert"><Icon name="alert" size={18} />{r.status.text}</p>}
            </fieldset>
          );
        })}
        {rows.length < MAX_ROWS && (
          <button type="button" className="btn-secondary btn-block supply-add-row" onClick={() => setRows((rs) => [...rs, newRow()])} disabled={busy}><Icon name="plus" />商品を追加</button>
        )}
        <label className="field">
          <span className="label">産地</span>
          <select value={shared.originPrefecture} onChange={(e) => setShare("originPrefecture", e.target.value)} aria-required="true">
            <option value="">選択</option>
            {data.prefectures.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <PickupChoice slots={data.slots} value={shared.slotId} onChange={(id) => setShare("slotId", id)} />
        <div className="field">
          <span className="label" id="pub-title">すぐに公開する？</span>
          <div className="seg" role="radiogroup" aria-labelledby="pub-title">
            <label><input type="radio" name="pub" checked={shared.published === "no"} onChange={() => setShare("published", "no")} />まだ公開しない</label>
            <label><input type="radio" name="pub" checked={shared.published === "yes"} onChange={() => setShare("published", "yes")} />公開する</label>
          </div>
        </div>
        {msg && <div className={`alert ${msg.tone}`} role="status"><Icon name={msg.tone === "ok" ? "check" : "alert"} />{msg.text}</div>}
        <button type="submit" className="btn-primary btn-block" disabled={busy} aria-busy={busy}>{busy ? <><span className="spinner" aria-hidden="true" />登録しています…</> : rows.length > 1 ? `${rows.length}件を登録する` : "登録する"}</button>
      </form>
    </details>
  );
}
