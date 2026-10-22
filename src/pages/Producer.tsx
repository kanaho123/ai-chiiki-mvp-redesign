import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import type { Me } from "../App";
import { formatDateJa, formatJstDateTime, jstTimeOf } from "../lib/dates.js";
import { NEARBY_PREFECTURES } from "../lib/constants.js";
import { handoverChoices, periodLabel, type HandoverPeriod } from "../lib/pickup.js";
import { Icon } from "../components/Icon";
import { MergeMark } from "../components/Motif";
import { useSpeech } from "../components/VoiceButton";
import { findItemByName, itemKey, ITEM_NAME_MAX, parseItemName } from "../lib/items.js";
import { PATHS } from "../routes/paths";
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
/** いつもの受け渡し場所（一般向けの環境だけ。デモ用の環境は null） */
type UsualPlace = { placeId: string; name: string; address: string; kind: string | null };
type Data = { supplies: Supply[]; slots: Slot[]; items: Item[]; prefectures: string[]; places?: UsualPlace[] | null };

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

/** 自分の供給一覧・受け渡しの回・品目（/api/supplies）の読み込み */
function useSupplyData() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  return { data, setData, loadError, reload };
}

/** これからの受け渡しの回（日時の早い順）。デモ用の環境は基準日時で判断する */
function useUpcomingSlots(data: Data | null) {
  const { demoNow } = useSession();
  const now = demoNow ? new Date(demoNow) : new Date();
  return (data?.slots ?? []).filter((s) => new Date(s.startAt).getTime() > now.getTime()).sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export default function ProducerPage({ me }: { me: Me }) {
  const { data, setData, loadError, reload } = useSupplyData();
  // 更新結果（何が変わったか）。一覧を読み直してもカードの下に残す
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);

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
      {data && data.supplies.length === 0 && <p className="muted">まだ出品はありません。</p>}

      {/* 新しい出品は専用の画面で（写真・声・手入力の入口から） */}
      {data && <Link className="btn-primary btn-block link-btn" to={PATHS.producer.newListing}><Icon name="plus" />新しく出品する</Link>}
    </main>
  );
}

/** AI の下書き（/api/supply-draft）。読み取れなかった項目は null */
type SupplyDraft = { itemName: string | null; availableKg: number | null; priceYenPerKg: number | null; grade: "regular" | "irregular" | null };

/**
 * 写真を AI に送る前に小さくする（長い辺 1024px・JPEG）。送るのは data URL。
 * 写真は data: URL で読み込む（本番の CSP は img-src 'self' data: で、blob: の画像は読み込めないため）
 */
async function shrinkPhoto(file: File, max = 1024): Promise<string> {
  const src = await new Promise<string>((ok, ng) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ng; r.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = src; });
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

/**
 * 出品の画面。入口は3つ：写真を撮る／話して入力する／手で入力する。
 * 写真・声は AI が品目・量・価格を下書きし（/api/supply-draft）、生産者が内容を確かめて直してから、今までの出品の API で登録する。
 * AI は下書きを作るだけで、登録・公開は生産者が「登録する」を押したときだけ。
 */
export function NewListingPage({ me }: { me: Me }) {
  const { data, loadError, reload } = useSupplyData();
  const { appMode } = useSession();
  const general = appMode === "general";
  const upcoming = useUpcomingSlots(data);
  const [step, setStep] = useState<"choose" | "reading" | "form" | "done">("choose");
  const [reading, setReading] = useState<"photo" | "voice">("photo");
  const [draft, setDraft] = useState<{ value: SupplyDraft | null; photo?: string; heard?: string; key: number }>({ value: null, key: 0 });
  const [aiError, setAiError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  async function askAi(body: { text?: string; image?: string }, kind: "photo" | "voice") {
    setReading(kind);
    setStep("reading");
    setAiError(null);
    const r = await send("/api/supply-draft", "POST", body);
    const value = r.ok ? (r.data as unknown as { draft?: SupplyDraft }).draft ?? null : null;
    if (!value) {
      setAiError(r.data.error ?? "AIで読み取れませんでした。手で入力してください");
      setStep("choose");
      return;
    }
    setDraft((d) => ({ value, photo: body.image, heard: body.text, key: d.key + 1 }));
    setStep("form");
  }
  async function onPhoto(file: File | undefined) {
    if (!file) return;
    try {
      await askAi({ image: await shrinkPhoto(file) }, "photo");
    } catch {
      setAiError("写真を読み込めませんでした。もう一度撮るか、手で入力してください");
      setStep("choose");
    }
  }
  const speech = useSpeech((text) => void askAi({ text }, "voice"));
  const manual = () => { setAiError(null); setDraft((d) => ({ value: null, key: d.key + 1 })); setStep("form"); };

  // はじめての出品で、まだ渡せる場所がない（一般向けの環境）：先に「普段、野菜をどこで渡せますか？」を1回だけ聞く
  const needPlace = !!data && general && (data.places?.length ?? 0) === 0;

  return (
    <main className="screen new-listing">
      <h1 className="display">出品する</h1>
      {loadError && <div className="alert bad" role="alert"><Icon name="alert" />{loadError}</div>}
      {data === null && !loadError && <p className="muted">読み込み中…</p>}
      {needPlace && <FirstPlaceSetup onDone={reload} />}

      {data && !needPlace && step === "choose" && (
        <section className="entry" aria-labelledby="entry-title">
          <h2 className="ps-title" id="entry-title">どうやって入力しますか？</h2>
          {aiError && <div className="alert bad" role="alert"><Icon name="alert" />{aiError}</div>}
          {speech.error && <div className="alert bad" role="alert"><Icon name="alert" />{speech.error}</div>}
          <div className="entry-choices">
            <button type="button" className="entry-choice main" onClick={() => photoRef.current?.click()}>
              <Icon name="camera" size={30} /><span><b>写真を撮る</b><small>AIが品目を読み取ります</small></span>
            </button>
            <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            {speech.supported && (
              <button type="button" className={`entry-choice ${speech.listening ? "listening" : ""}`} aria-pressed={speech.listening} onClick={speech.listening ? speech.stop : speech.start}>
                <Icon name="mic" size={30} />
                <span>{speech.listening ? <><b>聞いています…</b><small>話し終えたら、押して止めます</small></> : <><b>話して入力する</b><small>例：「トマト 10キロ 1キロ500円」</small></>}</span>
              </button>
            )}
            <button type="button" className="entry-choice" onClick={manual}>
              <Icon name="edit" size={30} /><span><b>手で入力する</b></span>
            </button>
          </div>
        </section>
      )}

      {step === "reading" && (
        <section className="loading" role="status" aria-live="polite" aria-labelledby="reading-title">
          <MergeMark flowing className="loading-mark" />
          <h2 className="loading-title" id="reading-title">{reading === "photo" ? "写真を読み取っています" : "話した内容を読み取っています"}</h2>
          <p className="loading-text">品目・量を下書きしています（10秒ほど）</p>
        </section>
      )}

      {data && !needPlace && step === "form" && (
        <>
          {draft.value && (
            <div className="draft-note" role="status">
              {draft.photo && <img className="draft-photo" src={draft.photo} alt="撮った写真" />}
              <p><b>AIの下書きです</b><br />{draft.heard ? `「${draft.heard}」から読み取りました。` : ""}違うところは直してください。</p>
            </div>
          )}
          <NewSupply key={draft.key} data={{ ...data, slots: upcoming }} defaultOrigin={me.producer?.originPrefecture ?? ""}
            initial={draft.value ?? undefined} general={general}
            onCreated={(text) => { void reload(); if (text) { setCreated(text); setStep("done"); } }} />
          <button type="button" className="text-btn" onClick={() => { setAiError(null); setStep("choose"); }}>入力のしかたを選び直す</button>
        </>
      )}

      {step === "done" && created && (
        <section className="entry-done" aria-labelledby="done-title">
          <div className="alert ok" role="status"><Icon name="check" /><div><b id="done-title">出品しました</b><br />{created}</div></div>
          <Link className="btn-primary btn-block link-btn" to={PATHS.producer.home}>ホームへ</Link>
          <button type="button" className="btn-secondary btn-block" onClick={() => { setCreated(null); setStep("choose"); }}><Icon name="plus" />続けて出品する</button>
          <Link className="text-btn link-btn" to={PATHS.producer.listings}>いまの出品を見る<Icon name="chevronRight" /></Link>
        </section>
      )}
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
/** 全行に共通（産地・受け渡し・公開するか）。受け渡しは、一般向けの環境では「いつもの場所・渡せる日・時間帯」、デモ用の環境では受渡の回（slotId） */
type SupplyShared = { originPrefecture: string; slotId: string; placeId: string; date: string; period: HandoverPeriod | ""; published: "" | "yes" | "no" };
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
 * 受け渡し（一般向けの環境）：いつもの場所（最初から選んでおく）＋今回渡せる日＋時間帯（午前／午後）。
 * 場所に曜日・時間は持たせない（収穫や予定で変わるので、出品のたびに選ぶ）。細かい時刻はマッチング後のやり取りで決める
 */
function HandoverChoice({ places, value, onChange }: {
  places: UsualPlace[]; value: Pick<SupplyShared, "placeId" | "date" | "period">; onChange: (patch: Partial<SupplyShared>) => void;
}) {
  const [moreDays, setMoreDays] = useState(false);
  const choices = handoverChoices(new Date());
  const shown = moreDays ? choices : choices.slice(0, 7);
  const periods = choices.find((c) => c.date === value.date)?.periods ?? [];
  const place = places.find((p) => p.placeId === value.placeId) ?? places[0];
  if (!place) return null;
  return (
    <div className="field pickup-choice" data-field="handover">
      <span className="label">受け渡し</span>
      {places.length > 1 ? (
        <div className="pickup-options" role="group" aria-label="場所">
          {places.map((p) => <button key={p.placeId} type="button" className={`pickup-option ${p.placeId === place.placeId ? "on" : ""}`} aria-pressed={p.placeId === place.placeId} onClick={() => onChange({ placeId: p.placeId })}>{p.name}</button>)}
        </div>
      ) : (
        <div className="pickup-current"><b className="pickup-current-place"><Icon name="pin" size={20} />いつもの{place.name}<Icon name="check" size={20} strokeWidth={2.6} /></b></div>
      )}
      <span className="label" id="hd-date">渡せる日</span>
      <div className="pickup-options" role="group" aria-labelledby="hd-date">
        {shown.map((c) => (
          <button key={c.date} type="button" className={`pickup-option ${c.date === value.date ? "on" : ""}`} aria-pressed={c.date === value.date}
            onClick={() => onChange({ date: c.date, period: value.period && c.periods.includes(value.period) ? value.period : c.periods.length === 1 ? c.periods[0] : "" })}>
            {formatDateJa(c.date)}
          </button>
        ))}
        {!moreDays && choices.length > shown.length && <button type="button" className="text-btn" onClick={() => setMoreDays(true)}>もっと先の日</button>}
      </div>
      {value.date && (
        <>
          <span className="label" id="hd-period">時間帯</span>
          <div className="pickup-options" role="group" aria-labelledby="hd-period">
            {periods.map((p) => <button key={p} type="button" className={`pickup-option ${p === value.period ? "on" : ""}`} aria-pressed={p === value.period} onClick={() => onChange({ period: p })}>{periodLabel(p)}</button>)}
          </div>
        </>
      )}
      <span className="hint">細かい時間は、マッチングの後に飲食店とのやり取りで決められます。</span>
    </div>
  );
}

/**
 * 受け渡し（デモ用の環境）：いつもの場所と、いちばん近い日時を最初から選んでおく（毎回入力させない）。必要なときだけ「変更」。
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

/**
 * 新しい出品のフォーム（出品の画面）。initial は AI の下書き（最初の行に入れておき、生産者が確かめて直す）。
 * onCreated には、全部登録できたときだけ結果の文を渡す
 */
function NewSupply({ data, defaultOrigin, onCreated, general = false, initial }: {
  data: Data; defaultOrigin: string; onCreated: (text?: string) => void; general?: boolean; initial?: SupplyDraft;
}) {
  const keyRef = useRef(1);
  const newRow = (): SupplyRow => ({ key: keyRef.current++, itemName: "", varietyId: "", grade: "regular", irregularReason: "", availableKg: "", priceYenPerKg: "", minKg: "1", status: null });
  const [rows, setRows] = useState<SupplyRow[]>(() => [{
    ...newRow(),
    ...(initial && {
      itemName: initial.itemName ?? "",
      grade: initial.grade ?? "regular",
      availableKg: initial.availableKg === null ? "" : String(initial.availableKg),
      priceYenPerKg: initial.priceYenPerKg === null ? "" : String(initial.priceYenPerKg),
    }),
  }]);
  const [shared, setShared] = useState<SupplyShared>({ originPrefecture: defaultOrigin, slotId: "", placeId: data.places?.[0]?.placeId ?? "", date: "", period: "", published: "" });
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
    if (general && (!shared.placeId || !shared.date || !shared.period)) {
      setMsg({ tone: "bad", text: "まだ登録していません。受け渡しの場所・渡せる日・時間帯を選んでください" });
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
        ...(general ? { handover: { placeId: shared.placeId, date: shared.date, period: shared.period } } : { slotId: shared.slotId }),
        published: shared.published === "" ? null : shared.published === "yes",
      });
      if (res.ok) done.push(`${res.data.supply!.item.name} ${res.data.supply!.availableKg}kg`);
      else failed.push({ ...r, status: { tone: "bad", text: res.data.error ?? "登録できませんでした" } });
    }
    setBusy(false);
    let createdText: string | undefined;
    if (failed.length === 0) {
      setRows([newRow()]);
      createdText = done.length === 1 ? `${done[0]} を登録しました` : `${done.length}件を登録しました（${done.join("・")}）`;
      setMsg({ tone: "ok", text: createdText });
    } else {
      setRows(failed); // 登録できた行は消し、できなかった行だけを理由つきで残す
      setMsg({ tone: "bad", text: done.length ? `${done.length}件を登録しました（${done.join("・")}）。${failed.length}件は登録できませんでした。理由が出ている行を確認してください` : "登録できませんでした。理由が出ている行を確認してください" });
    }
    if (done.length) onCreated(createdText);
  }

  const form = (
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
                  {/* 自由入力が主役。候補（すでにある品目）は、入力を始めてからだけ出す（一覧から選ぶ欄に見せない） */}
                  <input name="itemName" value={r.itemName} onChange={(e) => setRow(r.key, { itemName: e.target.value, varietyId: "" })} list={r.itemName.trim() ? "supply-item-options" : undefined}
                    maxLength={ITEM_NAME_MAX} placeholder="例：キャベツ、泉州水なす、九条ねぎ" aria-required="true" autoComplete="off" />
                  {isNew ? <span className="hint">新しい品目として登録します</span> : !r.itemName.trim() && <span className="hint">自由に入力できます。めずらしい野菜もそのまま書いてください</span>}
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
          {/* 関西の6府県を先に（農園の所在地の都道府県を最初から選んでおく。変えることもできる） */}
          <select value={shared.originPrefecture} onChange={(e) => setShare("originPrefecture", e.target.value)} aria-required="true">
            <option value="">選択</option>
            <optgroup label="関西">{NEARBY_PREFECTURES.map((p) => <option key={p}>{p}</option>)}</optgroup>
            <optgroup label="その他の都道府県">{data.prefectures.filter((p) => !(NEARBY_PREFECTURES as readonly string[]).includes(p)).map((p) => <option key={p}>{p}</option>)}</optgroup>
          </select>
        </label>
        {general
          ? <HandoverChoice places={data.places ?? []} value={shared} onChange={(patch) => setShared((x) => ({ ...x, ...patch }))} />
          : <PickupChoice slots={data.slots} value={shared.slotId} onChange={(id) => setShare("slotId", id)} />}
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
  );
  return <section className="more listing-form" aria-label="出品する内容">{form}</section>;
}
