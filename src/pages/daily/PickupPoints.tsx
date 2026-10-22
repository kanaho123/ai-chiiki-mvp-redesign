import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { kindOrOther, PICKUP_LIMITS, PRODUCER_KIND_CHOICES, WEEKDAY_LABEL, type PlaceKind } from "../../lib/pickup";
import { TextField } from "../onboarding/parts";

// 生産者の「いつもの受け渡し場所」。生産者には物流の設定をさせず、普段していることを1回だけ聞く：
//   「普段、野菜をどこで渡せますか？」→「場所を教えてください」（場所の名前と住所。すでにある場所から選ぶこともできる）。曜日・時間は聞かない
// 渡せる日と時間帯は出品のたびに選ぶ（収穫や予定で変わるため）。画面では「受渡枠」などの言葉を使わない。

export type UsualPlace = { placeId: string; name: string; address: string; kind: string | null; times: { seriesId: string; weekday: number; startTime: string; endTime: string; active: boolean }[] };
type Candidate = { placeId: string; name: string; address: string; kind: string | null };
type PickupData = { usual: UsualPlace[]; candidates: Candidate[] };

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

type Step = { kind: "where" } | { kind: "place"; placeKind: PlaceKind };

/** 2つの質問（どこで渡せますか？ → 場所の名前と住所）で「いつもの受け渡し場所」を登録する。曜日・時間は聞かない。終わったら onDone */
export function PickupSetup({ candidates, onDone, onCancel }: { candidates: Candidate[]; onDone: (usual: UsualPlace[]) => void; onCancel?: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "where" });
  const [draft, setDraft] = useState({ name: "", address: "" });
  const [showList, setShowList] = useState(false);
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
            <button key={c.value} type="button" className="ps-choice" onClick={() => { setDraft({ name: "", address: "" }); setShowList(false); setErrors({}); setStep({ kind: "place", placeKind: c.value }); }}>
              {c.label}<Icon name="chevronRight" />
            </button>
          ))}
        </div>
        {onCancel && <button type="button" className="text-btn ps-back" onClick={onCancel}>やめる</button>}
      </div>
    );
  }

  // どの種類でも同じ：場所の名前と住所を入れる。種類（「その他」など）は分類にだけ使い、画面には場所の名前を出す
  const placeKind = step.placeKind;
  const list = candidates.filter((c) => kindOrOther(c.kind) === placeKind);
  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const d = await confirmationApi<{ usual: UsualPlace[] }>("/api/pickup-points", "POST", body);
      onDone(d.usual);
    } catch (err) {
      setMessage(friendlyError(err, "登録できませんでした。もう一度お試しください"));
    } finally {
      setBusy(false);
    }
  }
  const submit = () => {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = "場所の名前を入れてください";
    if (!draft.address.trim()) e.address = "住所を入れてください";
    setErrors(e);
    if (Object.keys(e).length === 0) void save({ name: draft.name.trim(), address: draft.address.trim(), kind: placeKind });
  };
  return (
    <div className="pickup-setup" aria-labelledby="ps-place">
      <h2 className="ps-title" id="ps-place">場所を教えてください</h2>
      <div className="ps-form">
        <TextField name="name" label="場所の名前" value={draft.name} onChange={(v) => { setDraft({ ...draft, name: v }); setErrors({}); }} error={errors.name} maxLength={PICKUP_LIMITS.name} hint="例：〇〇直売所、JA〇〇集荷場、〇〇公民館" />
        <TextField name="address" label="住所" value={draft.address} onChange={(v) => { setDraft({ ...draft, address: v }); setErrors({}); }} error={errors.address} maxLength={PICKUP_LIMITS.address} />
        {message && <p className="alert bad" role="alert"><Icon name="alert" />{message}</p>}
        <button type="button" className="btn-primary btn-block" disabled={busy} aria-busy={busy} onClick={submit}>{busy ? <><span className="spinner" aria-hidden="true" />登録しています…</> : "この場所を登録する"}</button>
      </div>
      {/* 補助：ほかの農家・運営がすでに登録している場所を使う（同じ場所なら、複数の農家の分をまとめて受け取ってもらえる） */}
      {list.length > 0 && !showList && <button type="button" className="text-btn" onClick={() => setShowList(true)}>登録済みの場所から選ぶ</button>}
      {showList && (
        <ul className="ps-places">
          {list.map((c) => (
            <li key={c.placeId} className="ps-place">
              <b className="ps-place-name">{c.name}</b>
              {c.address && <span className="ps-place-address"><Icon name="pin" size={18} />{c.address}</span>}
              <button type="button" className="btn-secondary btn-block" disabled={busy} onClick={() => void save({ placeId: c.placeId })}>ここで渡せる</button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="text-btn ps-back" disabled={busy} onClick={() => setStep({ kind: "where" })}><Icon name="chevronRight" style={{ transform: "rotate(180deg)" }} />もどる</button>
    </div>
  );
}

/** 「いつもの受け渡し場所」のカード（📍場所・住所。以前に曜日・時間つきで登録した場所は、その曜日と時間も） */
export function UsualPlaceCards({ usual }: { usual: UsualPlace[] }) {
  return (
    <ul className="usual-places">
      {usual.map((p) => (
        <li key={p.placeId} className="usual-place">
          <b className="usual-place-name"><Icon name="pin" size={20} />{p.name}</b>
          {p.address && <span className="usual-place-when">{p.address}</span>}
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
