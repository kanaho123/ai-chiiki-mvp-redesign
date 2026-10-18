import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { parsePickupPoint, PICKUP_LIMITS, PLACE_KINDS, placeKindLabel, WEEKDAY_LABEL, weeklyText, type PlaceKind } from "../../lib/pickup";
import { ChoiceGroup, TextField } from "../onboarding/parts";

// 生産者のマイページ：「受け渡し可能地点」（普段の出荷・移動のついでに受け渡せる場所）の一覧と登録。
// 新しい配送を求めるものではない。登録した地点は毎週の受け渡し枠になり、出品のときに受け渡しの回として選べる。

type Point = { placeId: string; name: string; address: string; kind: string | null; note: string | null; series: { id: string; weekday: number; startTime: string; endTime: string; active: boolean; joined: boolean }[] };
type Draft = { name: string; address: string; kind: string; weekday: string; startTime: string; endTime: string; note: string };
const EMPTY: Draft = { name: "", address: "", kind: "", weekday: "", startTime: "", endTime: "", note: "" };
const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: `${WEEKDAY_LABEL[d]}曜日` }));

export function PickupPointsSection({ onChanged }: { onChanged?: () => void }) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    confirmationApi<{ points: Point[] }>("/api/pickup-points")
      .then((d) => { if (alive) setPoints(d.points); })
      .catch((e) => { if (alive) setLoadError(friendlyError(e, "受け渡し可能地点を読み込めませんでした")); });
    return () => { alive = false; };
  }, []);

  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setErrors({}); };

  async function save() {
    const checked = parsePickupPoint(draft);
    if (!checked.ok) { setErrors({ [checked.field]: checked.error }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const d = await confirmationApi<{ points: Point[] }>("/api/pickup-points", "POST", checked.value);
      setPoints(d.points);
      setAdding(false);
      setDraft(EMPTY);
      setMessage({ tone: "ok", text: `「${checked.value.name}」を登録しました。出品のときに、この地点の受け渡しの回を選べます` });
      onChanged?.();
    } catch (e) {
      setMessage({ tone: "bad", text: friendlyError(e, "登録できませんでした。もう一度お試しください") });
    } finally {
      setBusy(false);
    }
  }

  const full = (points?.length ?? 0) >= PICKUP_LIMITS.perProducer;
  return (
    <section className="profile-section pickup-points" aria-labelledby="pickup-title">
      <div className="profile-head">
        <h2 className="section-title" id="pickup-title">受け渡し可能地点</h2>
        {!adding && points && !full && <button type="button" className="text-btn" onClick={() => { setAdding(true); setMessage(null); }}><Icon name="plus" />追加</button>}
      </div>
      <p className="hint">普段の出荷や移動のついでに受け渡せる場所（直売所・集荷場・出荷先・農園など）を登録してください。新しく配送する必要はありません。</p>
      {message && <div className={`alert ${message.tone}`} role={message.tone === "bad" ? "alert" : "status"}><Icon name={message.tone === "ok" ? "check" : "alert"} />{message.text}</div>}
      {loadError && <p className="alert bad" role="alert">{loadError}</p>}
      {!points && !loadError && <p className="muted" aria-busy="true">読み込み中…</p>}
      {points && points.length === 0 && !adding && <p className="empty-note">まだ登録していません</p>}
      {points && points.length > 0 && (
        <ul className="pickup-list">
          {points.map((p) => (
            <li key={p.placeId} className="pickup-item">
              <span className="pickup-name"><b>{p.name}</b>{placeKindLabel(p.kind) && <span className="place-kind">{placeKindLabel(p.kind)}</span>}</span>
              <span className="pickup-address">{p.address}</span>
              {p.series.map((s) => <span key={s.id} className="pickup-when">{weeklyText(s)}{s.active ? "" : "（受付終了）"}</span>)}
              {p.note && <span className="pickup-note">{p.note}</span>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form className="onb-form profile-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <TextField name="name" label="地点名" value={draft.name} onChange={(v) => set({ name: v })} error={errors.name} maxLength={PICKUP_LIMITS.name} hint="例：〇〇直売所、JA〇〇集荷場" />
          <ChoiceGroup name="kind" legend="地点の種類" options={PLACE_KINDS} value={draft.kind as PlaceKind | ""} columns={2} onChange={(v) => set({ kind: v })} error={errors.kind} />
          <TextField name="address" label="住所" value={draft.address} onChange={(v) => set({ address: v })} error={errors.address} maxLength={PICKUP_LIMITS.address} />
          <ChoiceGroup name="weekday" legend="受け渡しできる曜日" options={WEEKDAY_OPTIONS} value={draft.weekday} columns={2} onChange={(v) => set({ weekday: v })} error={errors.weekday} />
          <TextField name="startTime" label="受け渡しできる時間（開始）" type="time" value={draft.startTime} onChange={(v) => set({ startTime: v })} error={errors.startTime} />
          <TextField name="endTime" label="受け渡しできる時間（終了）" type="time" value={draft.endTime} onChange={(v) => set({ endTime: v })} error={errors.endTime} />
          <TextField name="note" label="補足" optional value={draft.note} onChange={(v) => set({ note: v })} error={errors.note} maxLength={PICKUP_LIMITS.note} hint="例：店の裏口でお渡しします" />
          <div className="profile-actions">
            <button type="submit" className="btn-primary btn-block" disabled={busy} aria-busy={busy}>{busy ? <><span className="spinner" aria-hidden="true" />登録しています…</> : "登録する"}</button>
            <button type="button" className="btn-secondary btn-block" disabled={busy} onClick={() => { setAdding(false); setDraft(EMPTY); setErrors({}); }}>やめる</button>
          </div>
        </form>
      )}
      {full && <p className="hint">受け渡し可能地点は{PICKUP_LIMITS.perProducer}か所まで登録できます。</p>}
      <p className="hint">ほかの農家が登録した地点も、「できること・受渡枠」の「参加する受渡枠」から選んで参加できます（同じ場所でまとめて受け渡せます）。</p>
    </section>
  );
}
