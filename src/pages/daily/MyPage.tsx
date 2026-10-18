import { useEffect, useState } from "react";
import { isEmail, isPhone } from "../../lib/onboarding";
import type { Contact } from "../../lib/approvals";
import { confirmationApi, friendlyError } from "../../lib/confirmation-api";
import { nameOf, ROLE_TEXT } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import {
  BUSINESS_TYPES, checkProducer, checkRestaurant, DIRECT_TRADE_EXPERIENCES, FIRST_TIME_POLICIES, IRREGULAR_POLICIES, labelOf, LIMITS, PICKUP_TIMES,
  PRIORITY_MAX, PRODUCER_CAPABILITIES, producerStyle, PRODUCTION_STYLES, PURCHASE_FREQUENCIES, PURCHASE_PRIORITIES, PURCHASE_VOLUMES,
  restaurantStyle, SALES_CHANNELS, seriesWhen, stepErrors, type ProducerForm, type RestaurantForm,
} from "../../lib/onboarding";
import { useMe, useSession } from "../../routes/session";
import { ChoiceGroup, focusFirstError, MultiChoiceGroup, PrefectureField, StyleText, TextField } from "../onboarding/parts";
import { ErrorRetry } from "./ErrorRetry";
import { ListingsSummary } from "./ListingsSummary";

// マイページ：閲覧ではまとめて読みやすく表示し、「編集」を押した区切りだけを変更する（一度に1つの区切りだけ）。
// 保存はサーバーで初回登録と同じ確認をする。ログイン用メールアドレス・パスワードの変更は扱わない。
// デモ用の環境では簡単な表示に加え、生産者だけ「飲食店に伝える連絡先」を編集できる（Producer.contactPhone / contactEmail が正。
// 更新は既存の /api/approvals（本人の農園だけを更新するサーバーの確認つき）を使う。ログイン用の情報とは別）。

type SeriesOption = { id: string; placeName: string; placeAddress: string; weekday: number; startTime: string; endTime: string; feeYen: number; active: boolean };
type View =
  | { role: "restaurant"; profile: RestaurantForm }
  | { role: "producer"; profile: ProducerForm; items: { id: string; name: string }[]; series: SeriesOption[] };
type Errors = Partial<Record<string, string>>;

const R_SECTIONS = {
  shop: { title: "お店", fields: ["name", "businessType", "businessTypeOther", "prefecture", "city", "address", "phone"] },
  purchase: { title: "普段の仕入れ", fields: ["purchaseFrequency", "purchaseVolume"] },
  wishes: { title: "仕入れの希望", fields: ["irregularPolicy", "firstTimePolicy", "pickupTimes", "priorities"] },
} as const;
const P_SECTIONS = {
  farm: { title: "農園", fields: ["farmName", "producerName", "prefecture", "city"] },
  crops: { title: "作っているもの・販売", fields: ["itemIds", "otherCrops", "productionStyle", "salesChannels", "directTradeExperience"] },
  ability: { title: "できること・受渡枠", fields: ["capabilities", "seriesIds"] },
  contact: { title: "飲食店に伝える連絡先", fields: ["contactPhone", "contactEmail"] },
} as const;

const none = "設定していません";
const list = (xs: string[]) => (xs.length ? xs.join("・") : "選んでいません");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="info-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

/** 区切り（見出し＋編集ボタン。編集中は保存・やめるのボタン） */
function Section({ title, editing, canEdit, onEdit, onCancel, onSave, busy, children, form }: {
  title: string; editing: boolean; canEdit: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void; busy: boolean;
  children: React.ReactNode; form: React.ReactNode;
}) {
  return (
    <section className={`profile-section${editing ? " editing" : ""}`} aria-label={title}>
      <div className="profile-head">
        <h2 className="section-title">{title}</h2>
        {!editing && canEdit && <button type="button" className="text-btn" onClick={onEdit} aria-label={`${title}を編集する`}><Icon name="edit" />編集</button>}
      </div>
      {editing ? (
        <form className="onb-form profile-form" noValidate onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          {form}
          <div className="profile-actions">
            <button type="submit" className="btn-primary btn-block" disabled={busy} aria-busy={busy}>{busy ? <><span className="spinner" aria-hidden="true" />保存しています…</> : "保存する"}</button>
            <button type="button" className="btn-secondary btn-block" disabled={busy} onClick={onCancel}>やめる</button>
          </div>
        </form>
      ) : <dl className="info-rows">{children}</dl>}
    </section>
  );
}

export default function MyPage() {
  const me = useMe();
  const { appMode, logout, refresh } = useSession();
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadTick, setLoadTick] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const general = appMode === "general";

  useEffect(() => {
    if (!general) return;
    let alive = true;
    confirmationApi<View>("/api/profile")
      .then((d) => { if (alive) setView(d); })
      .catch((e) => { if (alive) setLoadError(friendlyError(e, "プロフィールを読み込めませんでした。もう一度お試しください")); });
    return () => { alive = false; };
  }, [general, loadTick]);

  const logoutButton = <button type="button" className="btn-secondary btn-block" onClick={logout}><Icon name="logout" />ログアウト</button>;

  // デモ用の環境・プロフィールがまだ読めないとき：基本の表示だけ
  if (!general || !view) {
    return (
      <main className="screen">
        <h1 className="display">マイページ</h1>
        {loadError && <ErrorRetry text={loadError} onRetry={() => { setLoadError(null); setLoadTick((t) => t + 1); }} />}
        {general && !view && !loadError && <p className="muted" aria-busy="true">読み込み中…</p>}
        <dl className="account-rows">
          <div><dt>使い方</dt><dd>{ROLE_TEXT[me.role]}</dd></div>
          <div><dt>{me.role === "producer" ? "農園名" : "店舗名"}</dt><dd>{nameOf(me)}</dd></div>
        </dl>
        {me.role === "producer" && <ListingsSummary />}
        {!general && me.role === "producer" && <DemoContactSection />}
        {logoutButton}
      </main>
    );
  }

  const form = { ...view.profile, ...draft } as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => {
    setDraft({ ...draft, ...patch });
    const cleared = { ...errors };
    for (const k of Object.keys(patch)) delete cleared[k];
    if ("contactPhone" in patch || "contactEmail" in patch) { delete cleared.contactPhone; delete cleared.contactEmail; }
    setErrors(cleared);
  };
  const sections: Record<string, { title: string; fields: readonly string[] }> = view.role === "restaurant" ? R_SECTIONS : P_SECTIONS;
  const start = (key: string) => { setEditing(key); setDraft({}); setErrors({}); setMessage(null); };
  const cancel = () => { setEditing(null); setDraft({}); setErrors({}); };

  async function save() {
    if (!editing || !view) return;
    const fields = sections[editing].fields;
    const checked = view.role === "restaurant" ? checkRestaurant(form) : checkProducer(form);
    const e = checked.ok ? {} : stepErrors(checked.errors as Errors, fields);
    if (Object.keys(e).length > 0) { setErrors(e); focusFirstError(fields, e); return; }
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setView(d as View);
        setEditing(null);
        setDraft({});
        setMessage({ tone: "ok", text: `「${sections[editing].title}」を保存しました` });
        await refresh(); // ヘッダーの店舗名・農園名も新しくする
        return;
      }
      if (r.status === 400 && d.errors) { setErrors(d.errors); focusFirstError(Object.keys(d.errors), d.errors); return; }
      setMessage({ tone: "bad", text: d.error ?? "保存できませんでした。時間をおいてもう一度お試しください" });
    } catch {
      setMessage({ tone: "bad", text: "通信に失敗しました。もう一度お試しください" });
    } finally {
      setBusy(false);
    }
  }

  const sectionProps = (key: string) => ({
    title: sections[key].title, editing: editing === key, canEdit: editing === null, busy,
    onEdit: () => start(key), onCancel: cancel, onSave: save,
  });

  if (view.role === "restaurant") {
    const p = view.profile;
    const f = form as RestaurantForm;
    const bt = p.businessType === "other" ? p.businessTypeOther : labelOf(BUSINESS_TYPES, p.businessType);
    return (
      <main className="screen">
        <h1 className="display">マイページ</h1>
        {message && <div className={`alert ${message.tone}`} role={message.tone === "bad" ? "alert" : "status"}><Icon name={message.tone === "ok" ? "check" : "alert"} />{message.text}</div>}
        <section className="style-card" aria-label="あなたの仕入れスタイル">
          <span className="eyebrow">あなたの仕入れスタイル</span>
          <StyleText text={restaurantStyle(p)} />
          <p className="hint">登録した内容からつくったまとめです。</p>
        </section>
        <Section {...sectionProps("shop")} form={<>
          <TextField name="name" label="店舗名" value={f.name} onChange={(v) => set({ name: v })} error={errors.name} maxLength={LIMITS.name} />
          <ChoiceGroup name="businessType" legend="業態" options={BUSINESS_TYPES} value={f.businessType} columns={2} onChange={(v) => set({ businessType: v })} error={errors.businessType} />
          {f.businessType === "other" && <TextField name="businessTypeOther" label="業態（その他）" value={f.businessTypeOther} onChange={(v) => set({ businessTypeOther: v })} error={errors.businessTypeOther} maxLength={LIMITS.businessTypeOther} />}
          <PrefectureField name="prefecture" value={f.prefecture} onChange={(v) => set({ prefecture: v })} error={errors.prefecture} />
          <TextField name="city" label="市区町村" value={f.city} onChange={(v) => set({ city: v })} error={errors.city} maxLength={LIMITS.city} />
          <TextField name="address" label="詳しい住所" optional value={f.address} onChange={(v) => set({ address: v })} error={errors.address} hint="生産者には表示しません" maxLength={LIMITS.address} />
          <TextField name="phone" label="お店の電話番号" optional type="tel" inputMode="tel" value={f.phone} onChange={(v) => set({ phone: v })} error={errors.phone} hint="生産者には表示しません" maxLength={LIMITS.phone} />
        </>}>
          <Row label="店舗名">{p.name}</Row>
          <Row label="業態">{bt}</Row>
          <Row label="地域">{p.prefecture}{p.city}</Row>
          <Row label="詳しい住所">{p.address || none}</Row>
          <Row label="電話番号">{p.phone || none}</Row>
        </Section>
        <Section {...sectionProps("purchase")} form={<>
          <ChoiceGroup name="purchaseFrequency" legend="仕入れの頻度" options={PURCHASE_FREQUENCIES} value={f.purchaseFrequency} columns={2} onChange={(v) => set({ purchaseFrequency: v })} error={errors.purchaseFrequency} />
          <ChoiceGroup name="purchaseVolume" legend="1回の仕入れ量" options={PURCHASE_VOLUMES} value={f.purchaseVolume} columns={2} onChange={(v) => set({ purchaseVolume: v })} error={errors.purchaseVolume} />
        </>}>
          <Row label="仕入れの頻度">{labelOf(PURCHASE_FREQUENCIES, p.purchaseFrequency)}</Row>
          <Row label="1回の量">{labelOf(PURCHASE_VOLUMES, p.purchaseVolume)}</Row>
        </Section>
        <Section {...sectionProps("wishes")} form={<>
          <ChoiceGroup name="irregularPolicy" legend="規格外の野菜" options={IRREGULAR_POLICIES} value={f.irregularPolicy} onChange={(v) => set({ irregularPolicy: v })} error={errors.irregularPolicy} />
          <ChoiceGroup name="firstTimePolicy" legend="初めて取引する農家" options={FIRST_TIME_POLICIES} value={f.firstTimePolicy} onChange={(v) => set({ firstTimePolicy: v })} error={errors.firstTimePolicy} />
          <MultiChoiceGroup name="pickupTimes" legend="受け取りたい時間帯" optional options={PICKUP_TIMES} value={f.pickupTimes} columns={2} exclusive="any" note="いくつでも選べます。選ばなくても保存できます" onChange={(v) => set({ pickupTimes: v })} error={errors.pickupTimes} />
          <MultiChoiceGroup name="priorities" legend="仕入れで大切にしたいこと" optional options={PURCHASE_PRIORITIES} value={f.priorities} columns={2} max={PRIORITY_MAX} note={`${PRIORITY_MAX}つまで選べます。選ばなくても保存できます`} onChange={(v) => set({ priorities: v })} error={errors.priorities} />
        </>}>
          <Row label="規格外の野菜">{labelOf(IRREGULAR_POLICIES, p.irregularPolicy)}</Row>
          <Row label="初めての農家">{labelOf(FIRST_TIME_POLICIES, p.firstTimePolicy)}</Row>
          <Row label="受け取り">{list(p.pickupTimes.map((v) => labelOf(PICKUP_TIMES, v)))}</Row>
          <Row label="大切にしたいこと">{list(p.priorities.map((v) => labelOf(PURCHASE_PRIORITIES, v)))}</Row>
        </Section>
        <p className="hint">ログイン用のメールアドレス・パスワードは、ここでは変更できません。</p>
        {logoutButton}
      </main>
    );
  }

  const p = view.profile;
  const f = form as ProducerForm;
  const itemName = (id: string) => view.items.find((i) => i.id === id)?.name ?? "";
  const seriesText = (id: string) => { const s = view.series.find((x) => x.id === id); return s ? `${s.placeName}（${seriesWhen(s)}）${s.active ? "" : "・受付終了"}` : ""; };
  return (
    <main className="screen">
      <h1 className="display">マイページ</h1>
      {message && <div className={`alert ${message.tone}`} role={message.tone === "bad" ? "alert" : "status"}><Icon name={message.tone === "ok" ? "check" : "alert"} />{message.text}</div>}
      <ListingsSummary />
      <section className="style-card" aria-label="あなたの販売スタイル">
        <span className="eyebrow">あなたの販売スタイル</span>
        <StyleText text={producerStyle(p)} />
        <p className="hint">登録した内容からつくったまとめです。</p>
      </section>
      <Section {...sectionProps("farm")} form={<>
        <TextField name="farmName" label="農園名" value={f.farmName} onChange={(v) => set({ farmName: v })} error={errors.farmName} maxLength={LIMITS.name} />
        <TextField name="producerName" label="生産者名（担当者名）" value={f.producerName} onChange={(v) => set({ producerName: v })} error={errors.producerName} maxLength={LIMITS.producerName} />
        <PrefectureField name="prefecture" value={f.prefecture} onChange={(v) => set({ prefecture: v })} error={errors.prefecture} />
        <TextField name="city" label="市区町村" value={f.city} onChange={(v) => set({ city: v })} error={errors.city} maxLength={LIMITS.city} />
      </>}>
        <Row label="農園名">{p.farmName}</Row>
        <Row label="生産者名">{p.producerName}</Row>
        <Row label="地域">{p.prefecture}{p.city}</Row>
      </Section>
      <Section {...sectionProps("crops")} form={<>
        <MultiChoiceGroup name="itemIds" legend="主な作物" options={view.items.map((i) => ({ value: i.id, label: i.name }))} value={f.itemIds} columns={2} note="出品できるのは、この一覧にある品目です" onChange={(v) => set({ itemIds: v })} error={errors.itemIds} />
        <TextField name="otherCrops" label="その他の作物" optional value={f.otherCrops} onChange={(v) => set({ otherCrops: v })} error={errors.otherCrops} hint="プロフィール情報として登録されます（出品はできません）" maxLength={LIMITS.otherCrops} />
        <ChoiceGroup name="productionStyle" legend="生産のスタイル" options={PRODUCTION_STYLES} value={f.productionStyle} onChange={(v) => set({ productionStyle: v })} error={errors.productionStyle} />
        <MultiChoiceGroup name="salesChannels" legend="今の販売先" optional options={SALES_CHANNELS} value={f.salesChannels} columns={2} note="選ばなくても保存できます" onChange={(v) => set({ salesChannels: v })} error={errors.salesChannels} />
        <ChoiceGroup name="directTradeExperience" legend="飲食店との直接取引の経験" options={DIRECT_TRADE_EXPERIENCES} value={f.directTradeExperience} columns={2} onChange={(v) => set({ directTradeExperience: v })} error={errors.directTradeExperience} />
      </>}>
        <Row label="主な作物">{list(p.itemIds.map(itemName))}</Row>
        <Row label="その他の作物">{p.otherCrops || none}</Row>
        <Row label="生産のスタイル">{labelOf(PRODUCTION_STYLES, p.productionStyle)}</Row>
        <Row label="販売先">{list(p.salesChannels.map((v) => labelOf(SALES_CHANNELS, v)))}</Row>
        <Row label="直接取引の経験">{labelOf(DIRECT_TRADE_EXPERIENCES, p.directTradeExperience)}</Row>
      </Section>
      <Section {...sectionProps("ability")} form={<>
        <MultiChoiceGroup name="capabilities" legend="対応できること" optional options={PRODUCER_CAPABILITIES} value={f.capabilities} note="選ばなくても保存できます" onChange={(v) => set({ capabilities: v })} error={errors.capabilities} />
        <MultiChoiceGroup name="seriesIds" legend="参加する受渡枠"
          options={view.series.map((s) => ({ value: s.id, label: s.placeName, sub: `${seriesWhen(s)}・受渡料金 ${s.feeYen.toLocaleString("ja-JP")}円${s.active ? "" : "・受付終了（参加中のまま残せます）"}` }))}
          value={f.seriesIds} note="1つ以上選んでください。外した受渡枠でも、すでに予定に入っている回への参加はそのまま残ります" onChange={(v) => set({ seriesIds: v })} error={errors.seriesIds} />
      </>}>
        <Row label="対応できること">{list(p.capabilities.map((v) => labelOf(PRODUCER_CAPABILITIES, v)))}</Row>
        <Row label="受渡枠">{p.seriesIds.map((id) => <span key={id} className="summary-line">{seriesText(id)}</span>)}</Row>
      </Section>
      <Section {...sectionProps("contact")} form={<>
        <p className="contact-note"><Icon name="info" size={18} />この連絡先は、あなたが「対応できます」と返事をした飲食店だけに表示されます。電話番号かメールアドレスの、どちらか1つは必要です。</p>
        <TextField name="contactPhone" label="電話番号" optional noTag type="tel" inputMode="tel" value={f.contactPhone} onChange={(v) => set({ contactPhone: v })} error={errors.contactPhone} maxLength={LIMITS.phone} />
        <TextField name="contactEmail" label="メールアドレス" optional noTag type="email" inputMode="email" value={f.contactEmail} onChange={(v) => set({ contactEmail: v })} error={errors.contactEmail} autoComplete="off" maxLength={LIMITS.email} />
      </>}>
        <Row label="電話番号">{p.contactPhone || none}</Row>
        <Row label="メールアドレス">{p.contactEmail || none}</Row>
      </Section>
      <p className="hint">ログイン用のメールアドレス・パスワードは、ここでは変更できません。</p>
      {logoutButton}
    </main>
  );
}

/** デモ用の環境の生産者：飲食店に伝える連絡先だけを表示・編集する（電話番号かメールアドレスのどちらか1つは必要） */
function DemoContactSection() {
  const [contact, setContact] = useState<{ contactPhone: string; contactEmail: string } | null>(null);
  const [draft, setDraft] = useState({ contactPhone: "", contactEmail: "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    confirmationApi<{ contact: Contact }>("/api/approvals?view=contact", "GET", undefined, controller.signal)
      .then((d) => setContact({ contactPhone: d.contact.contactPhone ?? "", contactEmail: d.contact.contactEmail ?? "" }))
      .catch(() => { if (!controller.signal.aborted) setMessage({ tone: "bad", text: "連絡先を読み込めませんでした。画面を再読み込みしてください" }); });
    return () => controller.abort();
  }, []);

  async function save() {
    const phone = draft.contactPhone.trim();
    const email = draft.contactEmail.trim();
    const e: Errors = {};
    if (!phone && !email) e.contactPhone = "電話番号かメールアドレスのどちらかを入力してください";
    else {
      if (phone && !isPhone(phone)) e.contactPhone = "電話番号を確認してください（例：090-1234-5678）";
      if (email && !isEmail(email)) e.contactEmail = "メールアドレスを確認してください（例：farm@example.com）";
    }
    if (Object.keys(e).length > 0) { setErrors(e); focusFirstError(["contactPhone", "contactEmail"], e); return; }
    setBusy(true);
    setMessage(null);
    try {
      await confirmationApi("/api/approvals", "PATCH", { contactPhone: phone, contactEmail: email });
      setContact({ contactPhone: phone, contactEmail: email });
      setEditing(false);
      setMessage({ tone: "ok", text: "「飲食店に伝える連絡先」を保存しました" });
    } catch (err) {
      setMessage({ tone: "bad", text: friendlyError(err, "保存できませんでした。もう一度お試しください") });
    } finally {
      setBusy(false);
    }
  }
  const set = (patch: Partial<typeof draft>) => { setDraft({ ...draft, ...patch }); setErrors({}); };

  return (
    <>
      {message && <div className={`alert ${message.tone}`} role={message.tone === "bad" ? "alert" : "status"}><Icon name={message.tone === "ok" ? "check" : "alert"} />{message.text}</div>}
      {!contact && !message && <p className="muted" aria-busy="true">連絡先を読み込んでいます…</p>}
      {contact && (
        <Section title="飲食店に伝える連絡先" editing={editing} canEdit={!editing} busy={busy}
          onEdit={() => { setDraft(contact); setErrors({}); setMessage(null); setEditing(true); }} onCancel={() => { setEditing(false); setErrors({}); }} onSave={save}
          form={<>
            <p className="contact-note"><Icon name="info" size={18} />この連絡先は、あなたが「対応できます」と返事をした飲食店だけに表示されます。電話番号かメールアドレスの、どちらか1つは必要です。ログイン用の情報とは別です。</p>
            <TextField name="contactPhone" label="電話番号" optional noTag type="tel" inputMode="tel" value={draft.contactPhone} onChange={(v) => set({ contactPhone: v })} error={errors.contactPhone} maxLength={LIMITS.phone} />
            <TextField name="contactEmail" label="メールアドレス" optional noTag type="email" inputMode="email" value={draft.contactEmail} onChange={(v) => set({ contactEmail: v })} error={errors.contactEmail} autoComplete="off" maxLength={LIMITS.email} />
          </>}>
          <Row label="電話番号">{contact.contactPhone || none}</Row>
          <Row label="メールアドレス">{contact.contactEmail || none}</Row>
        </Section>
      )}
    </>
  );
}
