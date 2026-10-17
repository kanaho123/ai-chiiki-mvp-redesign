import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Icon } from "../../components/Icon";
import {
  BUSINESS_TYPES, checkRestaurant, EMPTY_RESTAURANT, FIRST_TIME_POLICIES, IRREGULAR_POLICIES, labelOf, LIMITS, PICKUP_TIMES, PRIORITY_MAX,
  PURCHASE_FREQUENCIES, PURCHASE_PRIORITIES, PURCHASE_VOLUMES, RESTAURANT_STEPS, restaurantStyle, stepErrors, type RestaurantField, type RestaurantForm,
} from "../../lib/onboarding";
import { homeOf, PATHS } from "../../routes/paths";
import { useMe, useSession } from "../../routes/session";
import { ChoiceGroup, focusFirstError, MultiChoiceGroup, PrefectureField, StepFrame, StyleText, SummaryRow, TextField, useDraft, WELCOME_KEY } from "./parts";

// 飲食店の初回登録：1 お店について → 2 普段の仕入れ → 3 仕入れの希望 → 4 確認（あなたの仕入れスタイル）。
// 各 STEP は URL（/onboarding/restaurant/1〜4）なので、ブラウザの戻る・再読み込みでも同じ画面に戻れる。

const BASE = PATHS.onboarding.restaurant;
const TOTAL = RESTAURANT_STEPS.length;
type Errors = Partial<Record<RestaurantField, string>>;

export default function RestaurantOnboarding() {
  const me = useMe();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const requested = Number(useParams()["*"]);
  const [form, setForm, clearDraft] = useDraft<RestaurantForm>(`${me.id}:restaurant`, EMPTY_RESTAURANT);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const checked = checkRestaurant(form);
  const allErrors: Errors = checked.ok ? {} : checked.errors;
  // まだ済んでいない最初の STEP（そこより先へは進めない）
  const firstOpen = RESTAURANT_STEPS.findIndex((s) => Object.keys(stepErrors(allErrors, s.fields)).length > 0);
  const reachable = firstOpen === -1 ? TOTAL : firstOpen + 1;
  if (!Number.isInteger(requested) || requested < 1 || requested > TOTAL) return <Navigate to={`${BASE}/1`} replace />;
  if (requested > reachable) return <Navigate to={`${BASE}/${reachable}`} replace />;
  const step = requested;

  const update = (patch: Partial<RestaurantForm>) => {
    setForm({ ...form, ...patch });
    const cleared = { ...errors };
    for (const k of Object.keys(patch) as RestaurantField[]) delete cleared[k];
    setErrors(cleared);
  };
  const go = (n: number) => { setErrors({}); navigate(`${BASE}/${n}`); };
  const stepOf = (field: string) => RESTAURANT_STEPS.findIndex((s) => (s.fields as string[]).includes(field)) + 1;

  function next() {
    const fields = RESTAURANT_STEPS[step - 1].fields;
    const e = stepErrors(allErrors, fields);
    if (Object.keys(e).length > 0) {
      setErrors(e);
      focusFirstError(fields, e);
      return;
    }
    go(step + 1);
  }

  async function submit() {
    if (!checked.ok) return go(Math.max(1, firstOpen + 1));
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/onboarding/restaurant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        clearDraft();
        try { sessionStorage.setItem(WELCOME_KEY, "restaurant"); } catch {}
        await refresh();
        navigate(homeOf("restaurant"), { replace: true });
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

  const common = { step, total: TOTAL, stepName: RESTAURANT_STEPS[step - 1].title, onBack: step > 1 ? () => go(step - 1) : undefined };

  if (step === 1) return (
    <StepFrame {...common} title="お店について教えてください" lead="店舗名は、生産者への確認依頼に表示されます。" cta="次へ" onNext={next}>
      <TextField name="name" label="店舗名" value={form.name} onChange={(v) => update({ name: v })} error={errors.name} autoComplete="organization" maxLength={LIMITS.name} />
      <ChoiceGroup name="businessType" legend="業態" options={BUSINESS_TYPES} value={form.businessType} columns={2}
        onChange={(v) => update({ businessType: v })} error={errors.businessType} />
      {form.businessType === "other" && (
        <TextField name="businessTypeOther" label="業態（その他）" value={form.businessTypeOther} onChange={(v) => update({ businessTypeOther: v })}
          error={errors.businessTypeOther} hint="例：定食屋、焼肉、レストランバー" maxLength={LIMITS.businessTypeOther} />
      )}
      <PrefectureField name="prefecture" value={form.prefecture} onChange={(v) => update({ prefecture: v })} error={errors.prefecture} />
      <TextField name="city" label="市区町村" value={form.city} onChange={(v) => update({ city: v })} error={errors.city} autoComplete="address-level2" hint="例：大阪市北区" maxLength={LIMITS.city} />
      <section className="later-block" aria-labelledby="later-title">
        <h2 className="later-title" id="later-title">入力しなくても登録できます</h2>
        <p className="hint">詳しい住所と電話番号は、今は入力しなくても登録できます。入力した場合も、生産者には表示しません。</p>
        <TextField name="address" label="詳しい住所" optional value={form.address} onChange={(v) => update({ address: v })} error={errors.address} autoComplete="street-address" maxLength={LIMITS.address} />
        <TextField name="phone" label="お店の電話番号" optional type="tel" inputMode="tel" value={form.phone} onChange={(v) => update({ phone: v })} error={errors.phone} autoComplete="tel" maxLength={LIMITS.phone} />
      </section>
    </StepFrame>
  );

  if (step === 2) return (
    <StepFrame {...common} title="普段の仕入れについて" lead="お店の普段の仕入れとして登録します。だいたいで大丈夫です。" cta="次へ" onNext={next}>
      <ChoiceGroup name="purchaseFrequency" legend="仕入れの頻度" options={PURCHASE_FREQUENCIES} value={form.purchaseFrequency} columns={2}
        onChange={(v) => update({ purchaseFrequency: v })} error={errors.purchaseFrequency} />
      <ChoiceGroup name="purchaseVolume" legend="1回の仕入れ量" options={PURCHASE_VOLUMES} value={form.purchaseVolume} columns={2}
        onChange={(v) => update({ purchaseVolume: v })} error={errors.purchaseVolume} />
    </StepFrame>
  );

  if (step === 3) return (
    <StepFrame {...common} title="どんな仕入れをしたいですか" lead="お店の仕入れの好みとして登録します。" cta="次へ" onNext={next}>
      <ChoiceGroup name="irregularPolicy" legend="規格外の野菜（形・大きさがそろわないもの）" options={IRREGULAR_POLICIES} value={form.irregularPolicy}
        onChange={(v) => update({ irregularPolicy: v })} error={errors.irregularPolicy} />
      <ChoiceGroup name="firstTimePolicy" legend="初めて取引する農家" options={FIRST_TIME_POLICIES} value={form.firstTimePolicy}
        onChange={(v) => update({ firstTimePolicy: v })} error={errors.firstTimePolicy} />
      <MultiChoiceGroup name="pickupTimes" legend="受け取りたい時間帯" optional options={PICKUP_TIMES} value={form.pickupTimes} columns={2} exclusive="any"
        note="いくつでも選べます。選ばなくても登録できます" onChange={(v) => update({ pickupTimes: v })} error={errors.pickupTimes} />
      <MultiChoiceGroup name="priorities" legend="仕入れで大切にしたいこと" optional options={PURCHASE_PRIORITIES} value={form.priorities} columns={2} max={PRIORITY_MAX}
        note={`${PRIORITY_MAX}つまで選べます。選ばなくても登録できます`} onChange={(v) => update({ priorities: v })} error={errors.priorities} />
    </StepFrame>
  );

  const bt = form.businessType === "other" ? form.businessTypeOther : labelOf(BUSINESS_TYPES, form.businessType);
  return (
    <StepFrame {...common} title="あなたの仕入れスタイル" cta="この内容ではじめる" ctaBusy={busy} onNext={submit}>
      <section className="style-card" aria-label="あなたの仕入れスタイル">
        <StyleText text={restaurantStyle(form)} />
        <p className="hint">選んだ内容からつくった、お店の仕入れのまとめです。</p>
      </section>
      <dl className="summary-rows">
        <SummaryRow label="お店" onEdit={() => go(1)}>{form.name}（{bt}）<br />{form.prefecture}{form.city}</SummaryRow>
        <SummaryRow label="普段の仕入れ" onEdit={() => go(2)}>{labelOf(PURCHASE_FREQUENCIES, form.purchaseFrequency)}・1回 {labelOf(PURCHASE_VOLUMES, form.purchaseVolume)}</SummaryRow>
        <SummaryRow label="規格外の野菜" onEdit={() => go(3)}>{labelOf(IRREGULAR_POLICIES, form.irregularPolicy)}</SummaryRow>
        <SummaryRow label="初めての農家" onEdit={() => go(3)}>{labelOf(FIRST_TIME_POLICIES, form.firstTimePolicy)}</SummaryRow>
        <SummaryRow label="受け取り" onEdit={() => go(3)}>{form.pickupTimes.length ? form.pickupTimes.map((v) => labelOf(PICKUP_TIMES, v)).join("・") : "選んでいません"}</SummaryRow>
        <SummaryRow label="大切にしたいこと" onEdit={() => go(3)}>{form.priorities.length ? form.priorities.map((v) => labelOf(PURCHASE_PRIORITIES, v)).join("・") : "選んでいません"}</SummaryRow>
      </dl>
      {(!form.address || !form.phone) && <p className="hint"><Icon name="info" size={18} /> 詳しい住所・電話番号は、今は入力しなくても登録できます。</p>}
      {submitError && <div className="alert bad" role="alert"><Icon name="alert" />{submitError}</div>}
    </StepFrame>
  );
}
