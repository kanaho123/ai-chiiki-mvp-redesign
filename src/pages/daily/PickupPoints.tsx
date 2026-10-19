import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { kindOrOther, PICKUP_LIMITS, PRODUCER_KIND_CHOICES, WEEKDAY_LABEL, type PlaceKind } from "../../lib/pickup";
import { TextField } from "../onboarding/parts";

// 生産者の「いつもの受け渡し場所」。生産者には物流の設定をさせず、普段していることを1回だけ聞く：
//   「普段、野菜をどこで渡せますか？」→「場所を教えてください」（すでにある場所なら「ここで渡せる」）→「いつ渡せますか？」
// 内部では既存の場所（Place）と毎週の枠（SlotSeries）を使う（同じ場所・曜日・時間なら同じ枠にまとまる）が、画面ではその言葉を使わない。

export type UsualPlace = { placeId: string; name: string; address: string; kind: string | null; times: { seriesId: string; weekday: number; startTime: string; endTime: string; active: boolean }[] };
type Candidate = { placeId: string; name: string; address: string; kind: string | null };
type PickupData = { usual: UsualPlace[]; candidates: Candidate[] };

/** 月曜はじまりの曜日（0=日〜6=土 の値を使う） */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
export const timesText = (t: { weekday: number; startTime: string; endTime: string }) => `${WEEKDAY_LABEL[t.weekday]}曜日 ${t.startTime}〜${t.endTime}`;

export function usePickupData() {
  const [data, setData] = useState<PickupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await confirmationApi<PickupData>("/api/pickup-points"));
      setError(null);
    } catch (e) {
      setError(friendlyError(e, "受け渡しの場所を読み込めませんでした。もう一度お試しください"));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload };
}

type Step = { kind: "where" } | { kind: "place"; placeKind: PlaceKind } | { kind: "when"; placeKind: PlaceKind; place: { placeId: string; name: string } | { name: string; address: string } };

/** 3つの質問で「いつもの受け渡し場所」を登録する。終わったら onDone（新しい「いつもの受け渡し場所」の一覧） */
export function PickupSetup({ candidates, onDone, onCancel }: { candidates: Candidate[]; onDone: (usual: UsualPlace[]) => void; onCancel?: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "where" });
  const [newPlace, setNewPlace] = useState<{ name: string; address: string } | null>(null);
  const [weekday, setWeekday] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (step.kind === "where") {
    return (
      <div className="pickup-setup" aria-labelledby="ps-where">
        <h2 className="ps-title" id="ps-where">普段、野菜をどこで渡せますか？</h2>
        <p className="ps-lead">いつもの出荷先や農園など、普段の移動のついでに渡せる場所を教えてください。新しく配送する必要はありません。</p>
        <div className="ps-choices">
          {PRODUCER_KIND_CHOICES.map((c) => (
            <button key={c.value} type="button" className="ps-choice" onClick={() => { setNewPlace(null); setStep({ kind: "place", placeKind: c.value }); }}>
              {c.label}<Icon name="chevronRight" />
            </button>
          ))}
        </div>
        {onCancel && <button type="button" className="text-btn ps-back" onClick={onCancel}>やめる</button>}
      </div>
    );
  }

  if (step.kind === "place") {
    const list = candidates.filter((c) => kindOrOther(c.kind) === step.placeKind);
    const typing = newPlace !== null || list.length === 0;
    const draft = newPlace ?? { name: "", address: "" };
    const next = () => {
      const e: Record<string, string> = {};
      if (!draft.name.trim()) e.name = "場所の名前を入れてください";
      if (!draft.address.trim()) e.address = "住所を入れてください";
      setErrors(e);
      if (Object.keys(e).length === 0) setStep({ kind: "when", placeKind: step.placeKind, place: { name: draft.name.trim(), address: draft.address.trim() } });
    };
    return (
      <div className="pickup-setup" aria-labelledby="ps-place">
        <h2 className="ps-title" id="ps-place">場所を教えてください</h2>
        {list.length > 0 && !typing && (
          <ul className="ps-places">
            {list.map((c) => (
              <li key={c.placeId} className="ps-place">
                <b className="ps-place-name">{c.name}</b>
                <span className="ps-place-address"><Icon name="pin" size={18} />{c.address}</span>
                <button type="button" className="btn-primary btn-block" onClick={() => setStep({ kind: "when", placeKind: step.placeKind, place: { placeId: c.placeId, name: c.name } })}>ここで渡せる</button>
              </li>
            ))}
          </ul>
        )}
        {!typing && <button type="button" className="btn-secondary btn-block" onClick={() => { setNewPlace({ name: "", address: "" }); setErrors({}); }}>ここにない場所を入れる</button>}
        {typing && (
          <div className="ps-form">
            <TextField name="name" label="場所の名前" value={draft.name} onChange={(v) => { setNewPlace({ ...draft, name: v }); setErrors({}); }} error={errors.name} maxLength={PICKUP_LIMITS.name} hint="例：〇〇直売所、JA〇〇集荷場、自宅の作業場" />
            <TextField name="address" label="住所" value={draft.address} onChange={(v) => { setNewPlace({ ...draft, address: v }); setErrors({}); }} error={errors.address} maxLength={PICKUP_LIMITS.address} />
            <button type="button" className="btn-primary btn-block" onClick={next}>次へ</button>
            {list.length > 0 && <button type="button" className="text-btn" onClick={() => { setNewPlace(null); setErrors({}); }}>候補から選ぶ</button>}
          </div>
        )}
        <button type="button" className="text-btn ps-back" onClick={() => setStep({ kind: "where" })}><Icon name="chevronRight" style={{ transform: "rotate(180deg)" }} />もどる</button>
      </div>
    );
  }

  const place = step.place;
  async function save() {
    const e: Record<string, string> = {};
    if (weekday === null) e.weekday = "渡せる曜日を選んでください";
    if (!startTime) e.startTime = "何時から渡せるかを入れてください";
    if (!endTime) e.endTime = "何時まで渡せるかを入れてください";
    else if (startTime && endTime <= startTime) e.endTime = "終わりの時刻は、始まりより後にしてください";
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    setMessage(null);
    const when = { weekday, startTime, endTime };
    const body = "placeId" in place ? { placeId: place.placeId, ...when } : { name: place.name, address: place.address, kind: step.kind === "when" ? step.placeKind : "other", ...when };
    try {
      const d = await confirmationApi<{ usual: UsualPlace[] }>("/api/pickup-points", "POST", body);
      onDone(d.usual);
    } catch (err) {
      setMessage(friendlyError(err, "登録できませんでした。もう一度お試しください"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pickup-setup" aria-labelledby="ps-when">
      <h2 className="ps-title" id="ps-when">いつ渡せますか？</h2>
      <p className="ps-where-picked"><Icon name="pin" size={20} />{place.name}</p>
      <fieldset className="field ps-weekdays" data-field="weekday">
        <legend className="label">曜日</legend>
        <div className="ps-weekday-grid">
          {WEEKDAYS.map((d) => (
            <button key={d} type="button" className={`ps-weekday ${weekday === d ? "on" : ""}`} aria-pressed={weekday === d} onClick={() => { setWeekday(d); setErrors({}); }}>{WEEKDAY_LABEL[d]}</button>
          ))}
        </div>
        {errors.weekday && <span className="field-error" role="alert">{errors.weekday}</span>}
      </fieldset>
      <div className="ps-times">
        <TextField name="startTime" label="何時から" type="time" value={startTime} onChange={(v) => { setStartTime(v); setErrors({}); }} error={errors.startTime} />
        <TextField name="endTime" label="何時まで" type="time" value={endTime} onChange={(v) => { setEndTime(v); setErrors({}); }} error={errors.endTime} />
      </div>
      {message && <p className="alert bad" role="alert"><Icon name="alert" />{message}</p>}
      <button type="button" className="btn-primary btn-block" disabled={busy} aria-busy={busy} onClick={() => void save()}>{busy ? <><span className="spinner" aria-hidden="true" />登録しています…</> : "この場所を登録する"}</button>
      <button type="button" className="text-btn ps-back" disabled={busy} onClick={() => setStep({ kind: "place", placeKind: step.placeKind })}><Icon name="chevronRight" style={{ transform: "rotate(180deg)" }} />もどる</button>
    </div>
  );
}

/** 「いつもの受け渡し場所」のカード（📍場所・曜日と時間） */
export function UsualPlaceCards({ usual }: { usual: UsualPlace[] }) {
  return (
    <ul className="usual-places">
      {usual.map((p) => (
        <li key={p.placeId} className="usual-place">
          <b className="usual-place-name"><Icon name="pin" size={20} />{p.name}</b>
          {p.times.map((t) => <span key={t.seriesId} className="usual-place-when">{timesText(t)}</span>)}
        </li>
      ))}
    </ul>
  );
}

/** マイページ：いつもの受け渡し場所（カード）と、場所の追加 */
export function UsualPlacesSection({ onChanged }: { onChanged?: () => void }) {
  const { data, error, reload } = usePickupData();
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  return (
    <section className="profile-section usual-places-section" aria-labelledby="usual-title">
      <div className="profile-head">
        <h2 className="section-title" id="usual-title">いつもの受け渡し場所</h2>
      </div>
      {done && <div className="alert ok" role="status"><Icon name="check" />{done}</div>}
      {error && <p className="alert bad" role="alert">{error}</p>}
      {!data && !error && <p className="muted" aria-busy="true">読み込み中…</p>}
      {data && !adding && (
        <>
          {data.usual.length === 0 ? <p className="empty-note">まだ登録していません</p> : <UsualPlaceCards usual={data.usual} />}
          <button type="button" className="btn-secondary btn-block" onClick={() => { setAdding(true); setDone(null); }}><Icon name="plus" />場所を追加する</button>
        </>
      )}
      {data && adding && (
        <PickupSetup candidates={data.candidates} onCancel={() => setAdding(false)}
          onDone={() => { setAdding(false); setDone("いつもの受け渡し場所を登録しました"); void reload(); onChanged?.(); }} />
      )}
    </section>
  );
}
