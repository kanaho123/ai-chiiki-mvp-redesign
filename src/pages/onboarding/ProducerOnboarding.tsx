import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Icon } from "../../components/Icon";
import {
  checkProducer, DIRECT_TRADE_EXPERIENCES, EMPTY_PRODUCER, labelOf, LIMITS, PRODUCER_CAPABILITIES, PRODUCER_STEPS, producerStyle, PRODUCTION_STYLES,
  SALES_CHANNELS, stepErrors, type ProducerField, type ProducerForm,
} from "../../lib/onboarding";
import { homeOf, PATHS } from "../../routes/paths";
import { useMe, useSession } from "../../routes/session";
import { ChoiceGroup, focusFirstError, MultiChoiceGroup, PrefectureField, StepFrame, StyleText, SummaryRow, TextField, useDraft, WELCOME_KEY } from "./parts";

// 生産者の初回登録：1 農園について → 2 作っているもの・販売 → 3 できること → 4 連絡先と確認（あなたの販売スタイル）。
// 品目はマスタ（/api/onboarding/master）から選ぶ。受け渡しの場所は聞かない（はじめて出品するときに1回だけ聞く）。内部の ID は画面に出さない。

const BASE = PATHS.onboarding.producer;
const TOTAL = PRODUCER_STEPS.length;
type Errors = Partial<Record<ProducerField, string>>;
type Master = { items: { id: string; name: string }[]; series: { id: string; placeName: string; placeAddress: string; placeKind?: string | null; weekday: number; startTime: string; endTime: string; feeYen: number }[] };

export default function ProducerOnboarding() {
  const me = useMe();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const requested = Number(useParams()["*"]);
  const [form, setForm, clearDraft] = useDraft<ProducerForm>(`${me.id}:producer`, EMPTY_PRODUCER);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [master, setMaster] = useState<Master | null>(null);
  const [masterError, setMasterError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/onboarding/master", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Master) => { if (alive) setMaster(d); })
      .catch(() => { if (alive) setMasterError(true); });
    return () => { alive = false; };
  }, []);
  // 保存していた選択のうち、今は選べないもの（運営が止めた受渡枠など）は外す
  useEffect(() => {
    if (!master) return;
    const items = form.itemIds.filter((id) => master.items.some((i) => i.id === id));
    const series = form.seriesIds.filter((id) => master.series.some((s) => s.id === id));
    if (items.length !== form.itemIds.length || series.length !== form.seriesIds.length) setForm({ ...form, itemIds: items, seriesIds: series });
  }, [master]);

  const checked = checkProducer(form);
  const allErrors: Errors = checked.ok ? {} : checked.errors;
  const firstOpen = PRODUCER_STEPS.slice(0, TOTAL - 1).findIndex((s) => Object.keys(stepErrors(allErrors, s.fields)).length > 0);
  const reachable = firstOpen === -1 ? TOTAL : firstOpen + 1;
  if (!Number.isInteger(requested) || requested < 1 || requested > TOTAL) return <Navigate to={`${BASE}/1`} replace />;
  if (requested > reachable) return <Navigate to={`${BASE}/${reachable}`} replace />;
  const step = requested;

  const update = (patch: Partial<ProducerForm>) => {
    setForm({ ...form, ...patch });
    const cleared = { ...errors };
    for (const k of Object.keys(patch) as ProducerField[]) delete cleared[k];
    if ("contactEmail" in patch || "contactPhone" in patch) { delete cleared.contactPhone; delete cleared.contactEmail; }
    setErrors(cleared);
  };
  const go = (n: number) => { setErrors({}); navigate(`${BASE}/${n}`); };
  const stepOf = (field: string) => PRODUCER_STEPS.findIndex((st) => (st.fields as string[]).includes(field)) + 1;
  const showErrors = (fields: readonly ProducerField[]) => {
    const e = stepErrors(allErrors, fields);
    if (Object.keys(e).length === 0) return false;
    setErrors(e);
    focusFirstError(fields, e);
    return true;
  };
  const next = () => { if (!showErrors(PRODUCER_STEPS[step - 1].fields)) go(step + 1); };

  async function submit() {
    if (showErrors(PRODUCER_STEPS[TOTAL - 1].fields)) return;
    if (!checked.ok) return go(Math.max(1, firstOpen + 1));
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/onboarding/producer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        clearDraft();
        try { sessionStorage.setItem(WELCOME_KEY, "producer"); } catch {}
        await refresh();
        navigate(homeOf("producer"), { replace: true });
        return;
      }
      if (r.status === 400 && d.errors) {
        const first = Object.keys(d.errors)[0];
        setErrors(d.errors);
        navigate(`${BASE}/${Math.max(1, stepOf(first))}`);
        focusFirstError([first], d.errors);
        return;
      }
      setSubmitError(d.error ?? "登録できませんでした。時間をおいてもう一度お試しください");
    } catch {
      setSubmitError("通信に失敗しました。もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  const common = { step, total: TOTAL, stepName: PRODUCER_STEPS[step - 1].title, onBack: step > 1 ? () => go(step - 1) : undefined };
  const masterNote = masterError
    ? <div className="alert bad" role="alert"><Icon name="alert" />選択肢を読み込めませんでした。画面を再読み込みしてください。</div>
    : !master ? <p className="muted" aria-busy="true">選択肢を読み込んでいます…</p> : null;

  if (step === 1) return (
    <StepFrame {...common} title="農園について教えてください" lead="農園名は、飲食店に表示されます。" cta="次へ" onNext={next}>
      <TextField name="farmName" label="農園名" value={form.farmName} onChange={(v) => update({ farmName: v })} error={errors.farmName} autoComplete="organization" maxLength={LIMITS.name} />
      <TextField name="producerName" label="生産者名（担当者名）" value={form.producerName} onChange={(v) => update({ producerName: v })} error={errors.producerName} autoComplete="name" maxLength={LIMITS.producerName} />
      <PrefectureField name="prefecture" value={form.prefecture} onChange={(v) => update({ prefecture: v })} error={errors.prefecture} />
      <TextField name="city" label="市区町村" value={form.city} onChange={(v) => update({ city: v })} error={errors.city} autoComplete="address-level2" hint="例：堺市南区" maxLength={LIMITS.city} />
    </StepFrame>
  );

  if (step === 2) return (
    <StepFrame {...common} title="作っているものと販売について" cta="次へ" onNext={next}>
      {masterNote}
      {master && (
        <MultiChoiceGroup name="itemIds" legend="主な作物" options={master.items.map((i) => ({ value: i.id, label: i.name }))} value={form.itemIds} columns={2}
          note="いくつでも選べます。出品できるのは、この一覧にある品目です" onChange={(v) => update({ itemIds: v })} error={errors.itemIds} />
      )}
      <TextField name="otherCrops" label="その他の作物" optional value={form.otherCrops} onChange={(v) => update({ otherCrops: v })} error={errors.otherCrops}
        hint="例：かぼちゃ、とうもろこし。その他の作物はプロフィール情報として登録されます（出品はできません）" maxLength={LIMITS.otherCrops} />
      <ChoiceGroup name="productionStyle" legend="生産のスタイル" options={PRODUCTION_STYLES} value={form.productionStyle}
        onChange={(v) => update({ productionStyle: v })} error={errors.productionStyle} />
      <MultiChoiceGroup name="salesChannels" legend="今の販売先" optional options={SALES_CHANNELS} value={form.salesChannels} columns={2}
        note="いくつでも選べます。選ばなくても登録できます" onChange={(v) => update({ salesChannels: v })} error={errors.salesChannels} />
      <ChoiceGroup name="directTradeExperience" legend="飲食店との直接取引の経験" options={DIRECT_TRADE_EXPERIENCES} value={form.directTradeExperience} columns={2}
        onChange={(v) => update({ directTradeExperience: v })} error={errors.directTradeExperience} />
    </StepFrame>
  );

  if (step === 3) return (
    // 受け渡しの場所はここでは聞かない（はじめて出品するときに「普段、野菜をどこで渡せますか？」と1回だけ聞く）
    <StepFrame {...common} title="できること" cta="次へ" onNext={next}>
      <MultiChoiceGroup name="capabilities" legend="対応できること" optional options={PRODUCER_CAPABILITIES} value={form.capabilities}
        note="当てはまるものを選んでください。選ばなくても登録できます" onChange={(v) => update({ capabilities: v })} error={errors.capabilities} />
    </StepFrame>
  );

  const itemNames = form.itemIds.map((id) => master?.items.find((i) => i.id === id)?.name).filter(Boolean).join("・");
  return (
    <StepFrame {...common} title="連絡先と確認" cta="この内容ではじめる" ctaBusy={busy} onNext={submit}>
      <section className="contact-block" aria-labelledby="contact-title">
        <h2 className="later-title label" id="contact-title">飲食店に伝える連絡先<span className="tag-req">どちらか1つ必須</span></h2>
        <p className="contact-note"><Icon name="info" size={18} />この連絡先は、あなたが「対応できます」と返事をした飲食店だけに表示されます。</p>
        <p className="hint">電話番号かメールアドレスの、どちらか1つは入力してください。ログインに使うメールアドレスとは別に設定できます。</p>
        <TextField name="contactPhone" label="電話番号" optional noTag type="tel" inputMode="tel" value={form.contactPhone} onChange={(v) => update({ contactPhone: v })}
          error={errors.contactPhone} autoComplete="tel" maxLength={LIMITS.phone} />
        <TextField name="contactEmail" label="メールアドレス" optional noTag type="email" inputMode="email" value={form.contactEmail} onChange={(v) => update({ contactEmail: v })}
          error={errors.contactEmail} autoComplete="off" maxLength={LIMITS.email} />
      </section>
      <section className="style-card" aria-label="あなたの販売スタイル">
        <span className="eyebrow">あなたの販売スタイル</span>
        <StyleText text={producerStyle(form)} />
      </section>
      <dl className="summary-rows">
        <SummaryRow label="農園" onEdit={() => go(1)}>{form.farmName}（{form.producerName}）<br />{form.prefecture}{form.city}</SummaryRow>
        <SummaryRow label="主な作物" onEdit={() => go(2)}>{itemNames}{form.otherCrops && <><br />その他：{form.otherCrops}</>}</SummaryRow>
        <SummaryRow label="販売" onEdit={() => go(2)}>{[labelOf(PRODUCTION_STYLES, form.productionStyle), ...form.salesChannels.map((v) => labelOf(SALES_CHANNELS, v))].join("・")}</SummaryRow>
        <SummaryRow label="対応できること" onEdit={() => go(3)}>{form.capabilities.length ? form.capabilities.map((v) => labelOf(PRODUCER_CAPABILITIES, v)).join("・") : "選んでいません"}</SummaryRow>
      </dl>
      {submitError && <div className="alert bad" role="alert"><Icon name="alert" />{submitError}</div>}
    </StepFrame>
  );
}
