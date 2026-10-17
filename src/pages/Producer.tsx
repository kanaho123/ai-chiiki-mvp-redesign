import { useCallback, useEffect, useState } from "react";
import type { Me } from "../App";
import { formatJstDateTime, jstTimeOf } from "../lib/dates.js";
import { Icon } from "../components/Icon";

// 生産者本人の供給一覧。主な操作は「数量を変更」と「公開停止／再開」。
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
type Slot = { id: string; label: string; placeName: string; startAt: string; endAt: string; participationConfirmed: boolean };
type Item = { id: string; name: string; varieties: { id: string; name: string }[] };
type Data = { supplies: Supply[]; slots: Slot[]; items: Item[]; prefectures: string[] };

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const slotText = (s: { label: string; placeName: string; startAt: string; endAt: string }) =>
  `${s.label}：${formatJstDateTime(s.startAt)}〜${jstTimeOf(s.endAt)}／${s.placeName}`;

async function send(url: string, method: string, body: unknown) {
  try {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d as { error?: string; supply?: Supply; before?: { availableKg: number; published: boolean } } };
  } catch {
    return { ok: false, status: 0, data: { error: "通信に失敗しました。もう一度お試しください" } };
  }
}

export default function ProducerPage({ me }: { me: Me }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 更新結果（何が変わったか）。一覧を読み直してもカードの下に残す
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/supplies", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error && e.message ? e.message : "供給を読み込めませんでした。再読み込みしてください。");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <main className="screen">
      <div className="title-block">
        <p className="eyebrow">{me.producer?.farmName ?? me.displayName}</p>
        <h1 className="display">今日出せる量</h1>
        <p className="lede">販売に回せる量（既存の注文分を除いた量）です。仕入れ案に出ても、数量が自動で減ることはありません。</p>
      </div>

      {loadError && <div className="alert bad" role="alert"><Icon name="alert" />{loadError}</div>}
      {data === null && !loadError && <p className="muted">読み込み中…</p>}
      <ul className="supply-list" aria-label="供給一覧">
        {data?.supplies.map((s) => (
          <SupplyCard
            key={`${s.id}:${s.version}`}
            supply={s}
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

      <p className="ai-note">数量の変更・公開停止をすると、飲食店に表示中の仕入れ案は「現在の情報ではない」と表示され、再計算が必要になります。</p>

      {data && <NewSupply data={data} defaultOrigin={me.producer?.originPrefecture ?? ""} onCreated={reload} />}
    </main>
  );
}

function SupplyCard({ supply: s, done, onChanged }: { supply: Supply; done: string | null; onChanged: (text?: string, updated?: Supply) => void }) {
  const [kg, setKg] = useState(String(s.availableKg));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string; conflict?: boolean } | null>(null);

  async function patch(body: { availableKg?: number | string; published?: boolean }) {
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
      ? `${before.availableKg}kg → ${after.availableKg}kgに更新しました`
      : after.published ? "公開を再開しました（仕入れ案に使われます）" : "公開を停止しました（仕入れ案に使われません）";
    onChanged(text, after);
  }

  // − / ＋ は数量を 1kg ずつ動かすだけ。送るのは主ボタンを押したときの確定値（0〜100kg）
  const step = (d: number) => {
    const cur = Number.isInteger(Number(kg)) && kg !== "" ? Number(kg) : s.availableKg;
    setKg(String(Math.min(100, Math.max(0, cur + d))));
  };
  const kgId = `kg-${s.id}`;
  const changed = kg !== String(s.availableKg);
  return (
    <li className={`supply listing ${s.published ? "" : "paused"}`}>
      {done && (
        <div className="supply-updated alert ok" role="status">
          <Icon name="check" size={18} />
          <div><strong>{done}</strong><p>仕入れ案に表示されても、数量が自動で減ることはありません。</p></div>
        </div>
      )}
      <div className="supply-body">
        <div className="supply-head">
          <span className="supply-title"><b>{s.item.name}</b><small>{s.originPrefecture}産・{s.grade === "irregular" ? `規格外：${s.irregularReason}` : "通常品"}</small></span>
          <span className={`chip ${s.published ? "chip-on" : "chip-off"}`}>{s.published ? "公開中" : "公開停止中"}</span>
        </div>

        {/* 数量更新専用のコントロール（淡いオレンジの面）：現在 → 変更後（最も大きく）→ 確定 */}
        <form className="qty-tool" onSubmit={(e) => { e.preventDefault(); patch({ availableKg: kg }); }}>
          <div className="supply-now">
            <span className="label">現在</span>
            <span className="figure stock">{s.availableKg}<small>kg</small></span>
            <span className="when">更新 {formatJstDateTime(s.updatedAt)}</span>
          </div>
          <label className="stepper-label" htmlFor={kgId}>変更後{changed && <span className="diff num">（{Number(kg) - s.availableKg > 0 ? "＋" : "−"}{Math.abs(Number(kg) - s.availableKg) || 0}kg）</span>}</label>
          <div className={`stepper ${changed ? "changed" : ""}`}>
            <button type="button" onClick={() => step(-1)} aria-label="1kg減らす" disabled={busy}>−</button>
            <span className="with-unit">
              <input id={kgId} type="number" inputMode="numeric" min={0} max={100} step={1} value={kg} onChange={(e) => setKg(e.target.value)} aria-label={`${s.item.name}の販売可能量`} />
              <em>kg</em>
            </span>
            <button type="button" onClick={() => step(1)} aria-label="1kg増やす" disabled={busy}>＋</button>
          </div>
          <button type="submit" className="btn-primary btn-block" disabled={busy || !changed} aria-busy={busy}>
            {busy ? <><span className="spinner" aria-hidden="true" />更新中…</> : changed ? `${s.availableKg}kg → ${kg || "?"}kg に変更する` : "数量を変えると更新できます"}
          </button>
        </form>
        {msg && (
          <div className={`alert ${msg.tone}`} role="alert">
            <Icon name="alert" />
            <div>
              {msg.text}
              {msg.conflict && <button type="button" className="btn-link" style={{ paddingLeft: 0 }} onClick={() => onChanged()}><Icon name="refresh" size={16} />最新情報を読み込む</button>}
            </div>
          </div>
        )}

        <p className="supply-meta"><span>{yen(s.priceYenPerKg)}/kg（税込）</span><span>最低{s.minKg}kg・1kg刻み</span><span>{slotText(s.slot)}</span></p>
        <div className="supply-foot listing-foot">
          <span className="muted small">{s.published ? "仕入れ案に使われます" : "仕入れ案に使われません（数量はそのまま）"}</span>
          <button type="button" className={s.published ? "btn-danger-link" : "btn-secondary"} onClick={() => patch({ published: !s.published })} disabled={busy}>
            <Icon name={s.published ? "pause" : "play"} size={16} />{s.published ? "公開を停止する" : "公開を再開する"}
          </button>
        </div>
      </div>
    </li>
  );
}

type NewForm = {
  itemId: string; varietyId: string; grade: "" | "regular" | "irregular"; irregularReason: string; originPrefecture: string;
  availableKg: string; priceYenPerKg: string; minKg: string; slotId: string; published: "" | "yes" | "no";
};

function NewSupply({ data, defaultOrigin, onCreated }: { data: Data; defaultOrigin: string; onCreated: () => void }) {
  const empty: NewForm = { itemId: "", varietyId: "", grade: "regular", irregularReason: "", originPrefecture: defaultOrigin, availableKg: "", priceYenPerKg: "", minKg: "1", slotId: "", published: "" };
  const [f, setF] = useState<NewForm>(empty);
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
    <details className="more">
      <summary>
        <span>新しく供給を登録する</span>
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
            <span className="label">規格外の理由</span>
            <input value={f.irregularReason} onChange={(e) => set("irregularReason", e.target.value)} maxLength={30} placeholder="例：形の不揃い" />
          </label>
        )}
        <div className="row2">
          <label className="field">
            <span className="label">販売可能量</span>
            <span className="with-unit"><input type="number" inputMode="numeric" min={0} max={100} step={1} value={f.availableKg} onChange={(e) => set("availableKg", e.target.value)} /><em>kg</em></span>
          </label>
          <label className="field">
            <span className="label">税込単価</span>
            <span className="with-unit"><input type="number" inputMode="numeric" min={1} step={1} value={f.priceYenPerKg} onChange={(e) => set("priceYenPerKg", e.target.value)} /><em>円/kg</em></span>
          </label>
        </div>
        <label className="field">
          <span className="label">最低販売量</span>
          <span className="with-unit"><input type="number" inputMode="numeric" min={1} max={100} step={1} value={f.minKg} onChange={(e) => set("minKg", e.target.value)} /><em>kg</em></span>
        </label>
        <label className="field">
          <span className="label">受渡枠（参加登録済みの枠から選択）</span>
          <select value={f.slotId} onChange={(e) => set("slotId", e.target.value)} aria-required="true">
            <option value="">選択</option>
            {data.slots.map((s) => <option key={s.id} value={s.id}>{slotText(s)}{s.participationConfirmed ? "" : "（参加確認待ち）"}</option>)}
          </select>
          <span className="hint">受渡場所・時間・受渡費は枠で決まります（自由入力はできません）。</span>
        </label>
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
