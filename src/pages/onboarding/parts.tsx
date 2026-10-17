import { useEffect, useId, useState } from "react";
import { BottomBar } from "../../components/BottomBar";
import { Icon } from "../../components/Icon";
import { NEARBY_PREFECTURES, PREFECTURES } from "../../lib/constants";

// 初回登録の画面部品：1画面1テーマの枠（進み具合・戻る・主ボタン1つ）と、大きめの選択肢・入力欄。
// 選んだ状態は色だけでなく、チェックの形と太字でも示す。誤りは各項目のすぐ下に出す。

/** 入力途中の内容は、このタブの中だけ（sessionStorage）に保存する。完了・ログアウトで消す */
export const DRAFT_PREFIX = "ai-chiiki:onboarding:v1:"; // ログアウト時は routes/session.tsx が ai-chiiki:onboarding: で始まるものをすべて消す
export function useDraft<T extends object>(key: string, empty: T): [T, (next: T) => void, () => void] {
  const storageKey = DRAFT_PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? { ...empty, ...JSON.parse(raw) } : empty;
    } catch {
      return empty;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };
  const clear = () => { try { sessionStorage.removeItem(storageKey); } catch {} };
  return [value, set, clear];
}
/** 登録完了を、ホームで1回だけ知らせるための目印 */
export const WELCOME_KEY = "ai-chiiki:onboarding:welcome";

export function StepFrame({ step, total, stepName, title, lead, onBack, cta, ctaBusy, onNext, children }: {
  step: number; total: number; stepName: string; title: string; lead?: string;
  onBack?: () => void; cta: string; ctaBusy?: boolean; onNext: () => void; children: React.ReactNode;
}) {
  return (
    <main className="screen has-bar onb">
      <div className="onb-top">
        {onBack ? (
          <button type="button" className="text-btn onb-back" onClick={onBack}><Icon name="chevronRight" style={{ transform: "rotate(180deg)" }} />戻る</button>
        ) : <span />}
        <div className="flow-progress" aria-label={`進み具合 ${step}/${total} ${stepName}`}>
          <span className="flow-count">{step} / {total}</span>
          <span className="flow-name">{stepName}</span>
          <span className="flow-segs" aria-hidden="true">{Array.from({ length: total }, (_, k) => <i key={k} className={k < step ? "on" : ""} />)}</span>
        </div>
      </div>
      <div className="title-block">
        <h1 className="display">{title}</h1>
        {lead && <p className="muted">{lead}</p>}
      </div>
      <form className="onb-form" noValidate onSubmit={(e) => { e.preventDefault(); onNext(); }}>
        {children}
        <BottomBar>
          <button type="submit" className="btn-primary btn-block" disabled={ctaBusy} aria-busy={ctaBusy}>
            {ctaBusy ? <><span className="spinner" aria-hidden="true" />保存しています…</> : <>{cta}{cta === "次へ" && <Icon name="arrowRight" />}</>}
          </button>
        </BottomBar>
      </form>
    </main>
  );
}

const Need = ({ optional }: { optional?: boolean }) =>
  optional ? <span className="tag-opt">任意</span> : <span className="tag-req">必須</span>;

export function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <span className="field-error" id={id} role="alert"><Icon name="alert" size={18} />{text}</span>;
}

export function TextField({ name, label, value, onChange, error, optional, noTag, hint, type = "text", autoComplete, inputMode, maxLength }: {
  name: string; label: string; value: string; onChange: (v: string) => void; error?: string; optional?: boolean; noTag?: boolean; hint?: string;
  type?: string; autoComplete?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; maxLength?: number;
}) {
  const id = useId();
  return (
    <label className="field" data-field={name}>
      <span className="label">{label}{!noTag && <Need optional={optional} />}</span>
      <input name={name} type={type} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} inputMode={inputMode} maxLength={maxLength}
        aria-required={!optional} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} />
      {hint && !error && <span className="hint" id={`${id}-h`}>{hint}</span>}
      <FieldError id={`${id}-e`} text={error} />
    </label>
  );
}

export function PrefectureField({ name, value, onChange, error }: { name: string; value: string; onChange: (v: string) => void; error?: string }) {
  const id = useId();
  const rest = PREFECTURES.filter((p) => !(NEARBY_PREFECTURES as readonly string[]).includes(p));
  return (
    <label className="field" data-field={name}>
      <span className="label">都道府県<Need /></span>
      <select name={name} value={value} onChange={(e) => onChange(e.target.value)} aria-required="true" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined}>
        <option value="">選んでください</option>
        <optgroup label="近畿">{NEARBY_PREFECTURES.map((p) => <option key={p}>{p}</option>)}</optgroup>
        <optgroup label="そのほか">{rest.map((p) => <option key={p}>{p}</option>)}</optgroup>
      </select>
      <FieldError id={`${id}-e`} text={error} />
    </label>
  );
}

type Opt<V extends string> = { value: V; label: string; sub?: string };

/** 1つだけ選ぶ（大きめの行。2列にするのは短い選択肢だけ） */
export function ChoiceGroup<V extends string>({ name, legend, options, value, onChange, error, columns = 1, optional }: {
  name: string; legend: string; options: readonly Opt<V>[]; value: V | ""; onChange: (v: V) => void; error?: string; columns?: 1 | 2; optional?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="field" data-field={name} aria-describedby={error ? `${id}-e` : undefined}>
      <legend className="label">{legend}<Need optional={optional} /></legend>
      <div className={`choice-list cols-${columns}`}>
        {options.map((o) => (
          <label key={o.value} className="option-card choice">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
            <span><b>{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
          </label>
        ))}
      </div>
      <FieldError id={`${id}-e`} text={error} />
    </fieldset>
  );
}

/** いくつでも選ぶ（max があれば、それ以上は選べず、その場で理由を出す） */
export function MultiChoiceGroup<V extends string>({ name, legend, options, value, onChange, error, columns = 1, max, optional, note, exclusive }: {
  name: string; legend: string; options: readonly Opt<V>[]; value: V[]; onChange: (v: V[]) => void; error?: string; columns?: 1 | 2;
  max?: number; optional?: boolean; note?: string; exclusive?: V; // exclusive：ほかと同時に選べない選択肢（例：特にこだわらない）
}) {
  const id = useId();
  const [limitHit, setLimitHit] = useState(false);
  useEffect(() => { if (!max || value.length < max) setLimitHit(false); }, [value.length, max]);
  function toggle(v: V) {
    if (value.includes(v)) return onChange(value.filter((x) => x !== v));
    if (exclusive && v === exclusive) return onChange([v]);
    const base = exclusive ? value.filter((x) => x !== exclusive) : value;
    if (max && base.length >= max) return setLimitHit(true);
    onChange([...base, v]);
  }
  return (
    <fieldset className="field" data-field={name} aria-describedby={error ? `${id}-e` : note ? `${id}-n` : undefined}>
      <legend className="label">
        {legend}<Need optional={optional} />
        {max && <span className="choice-count" aria-live="polite">{value.length} / {max} 選択中</span>}
      </legend>
      {note && <span className="hint" id={`${id}-n`}>{note}</span>}
      <div className={`choice-list cols-${columns}`}>
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <label key={o.value} className={`option-card choice multi${!on && max && value.length >= max ? " at-limit" : ""}${o.value === exclusive ? " span-all" : ""}`}>
              <input type="checkbox" name={name} value={o.value} checked={on} onChange={() => toggle(o.value)} />
              <span className="tick square" aria-hidden="true"><Icon name="check" size={16} /></span>
              <span><b>{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
            </label>
          );
        })}
      </div>
      {limitHit && <span className="limit-note" role="status"><Icon name="info" size={18} />{max}つまで選べます。入れ替えるときは、先にどれかを外してください</span>}
      <FieldError id={`${id}-e`} text={error} />
    </fieldset>
  );
}

/** 「次へ」で見つかった最初の誤りの項目へ移動する */
export function focusFirstError(fields: readonly string[], errors: Partial<Record<string, string>>) {
  const first = fields.find((f) => errors[f]);
  if (!first) return;
  const run = () => {
    const el = document.querySelector<HTMLElement>(`[data-field="${first}"]`);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el?.querySelector<HTMLElement>("input, select")?.focus({ preventScroll: true });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

/** 「地元産 × 少量仕入れ × 規格外OK」を、語の途中で折り返さないように表示する */
export function StyleText({ text }: { text: string }) {
  const parts = text.split(" × ");
  return <p className="style-text">{parts.map((p, i) => <span key={p}>{i > 0 && <span className="style-x" aria-hidden="true"> × </span>}<span className="nowrap">{p}</span></span>)}</p>;
}

/** 確認画面の要約の1行（見出し・内容・変更ボタン） */
export function SummaryRow({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit?: () => void }) {
  return (
    <div className="summary-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
      {onEdit && <button type="button" className="text-btn summary-edit" onClick={onEdit} aria-label={`${label}を変更する`}>変更</button>}
    </div>
  );
}
