import { useState } from "react";
import { Link, Navigate } from "react-router";
import { Icon } from "../components/Icon";
import { demoEntryUrl, PATHS } from "../routes/paths";
import { OPERATOR } from "../lib/legal";
import { useSession } from "../routes/session";
import Onboarding from "./Onboarding";
import RoleSelect from "./RoleSelect";

// ログイン前の画面。
// ・一般向けの環境（general）：トップ → 新規登録／ログイン。「デモを試す」はデモ用の別の環境へ案内する
// ・デモ用の環境（demo）：これまでどおり、初回の説明 → 役割を選んでデモ用アカウントでログイン

// 初回の説明（4画面）を見終わったか（端末ごとの表示の都合だけに使う。読めなければ毎回表示）
const INTRO_KEY = "ai-chiiki:onboarded:v1";
const readIntroSeen = () => { try { return localStorage.getItem(INTRO_KEY) === "1"; } catch { return false; } };
const writeIntroSeen = () => { try { localStorage.setItem(INTRO_KEY, "1"); } catch {} };

/** デモ用の環境の入口（初回の説明 → 役割の選択とログイン） */
function DemoEntry() {
  const { setMe } = useSession();
  const [introSeen, setIntroSeen] = useState(readIntroSeen);
  if (!introSeen) return <Onboarding onDone={() => { writeIntroSeen(); setIntroSeen(true); }} />;
  return <RoleSelect onLoggedIn={setMe} />;
}

export function Welcome() {
  const { appMode } = useSession();
  if (appMode !== "general") return <DemoEntry />;
  return (
    <main className="screen guest-screen">
      <div className="title-block">
        <h1 className="display">地域の食材を、<span className="nowrap">必要な分だけ</span></h1>
        <p className="guest-value">複数の農家から集めても、受け取りは1か所。</p>
        <p className="muted">飲食店は、足りない仕入れを近くの生産者の供給を組み合わせて補えます。生産者は、今日出せる量を数タップで登録できます。</p>
      </div>
      <div className="guest-actions">
        <Link className="btn-primary btn-block link-btn" to={PATHS.signup}>はじめての方（新規登録）</Link>
        <Link className="btn-secondary btn-block link-btn" to={PATHS.login}>登録済みの方（ログイン）</Link>
        {demoEntryUrl() && <a className="text-btn link-btn" href={demoEntryUrl()!}>まずはデモを試す<Icon name="chevronRight" /></a>}
      </div>
    </main>
  );
}

export function Demo() {
  const { appMode } = useSession();
  if (appMode !== "general") return <DemoEntry />;
  return (
    <main className="screen guest-screen">
      <div className="title-block">
        <h1 className="display">デモを試す</h1>
        <p className="muted">架空の農家・在庫・価格だけが入った、デモ用の別の画面を開きます。ここで登録したアカウントや情報は使いません。</p>
      </div>
      <div className="guest-actions">
        {demoEntryUrl()
          ? <a className="btn-primary btn-block link-btn" href={demoEntryUrl()!}>デモの画面を開く<Icon name="arrowRight" /></a>
          : <p className="empty-note">デモの画面の場所が設定されていません。運営にお問い合わせください。</p>}
        <Link className="text-btn link-btn" to={PATHS.welcome}>トップに戻る</Link>
      </div>
    </main>
  );
}

export function Login() {
  const { appMode, setMe } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (appMode !== "general") return <Navigate to={PATHS.demo} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error ?? "ログイン情報を確認してください");
      setPassword("");
      setMe(d.user); // 行き先（ホーム／初回登録）はガードが決める
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen guest-screen">
      <h1 className="display">ログイン</h1>
      <form className="form-stack" onSubmit={submit} noValidate>
        <label className="field">
          <span className="label">メールアドレス</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" inputMode="email" aria-required="true" />
        </label>
        <label className="field">
          <span className="label">パスワード</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-required="true" />
        </label>
        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
        <button type="submit" className="btn-primary btn-block" disabled={busy || !email || !password} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />確認しています…</> : "ログイン"}
        </button>
      </form>
      <details className="more-info">
        <summary>パスワードを忘れた方</summary>
        <p className="hint">いまは、画面やメールでパスワードを設定し直す機能はありません。お手数ですが、<a className="inline-link" href={`mailto:${OPERATOR.contact}`}>{OPERATOR.contact}</a> までご連絡ください。</p>
      </details>
      <p className="guest-switch">はじめての方は <Link to={PATHS.signup}>新規登録</Link></p>
    </main>
  );
}

type Field = "email" | "password" | "passwordConfirm" | "role" | "legal";

export function Signup() {
  const { appMode, setMe } = useSession();
  const [f, setF] = useState({ email: "", password: "", passwordConfirm: "", role: "" as "" | "restaurant" | "producer", legalAccepted: false });
  const [error, setError] = useState<{ field?: Field; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (appMode !== "general") return <Navigate to={PATHS.demo} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError({ field: d.field, text: d.error ?? "登録できませんでした。時間をおいてもう一度お試しください" });
      setMe(d.user); // 登録後はそのままログイン状態。初回登録の画面へはガードが案内する
    } catch {
      setError({ text: "通信に失敗しました。もう一度お試しください" });
    } finally {
      setBusy(false);
    }
  }
  const errorFor = (field: Field) => error?.field === field && <span className="field-error" role="alert"><Icon name="alert" size={18} />{error.text}</span>;

  return (
    <main className="screen guest-screen">
      <h1 className="display">新規登録</h1>
      <form className="form-stack" onSubmit={submit} noValidate>
        <fieldset className="field">
          <legend className="label">どちらで使いますか</legend>
          <div className="option-cards">
            {(["restaurant", "producer"] as const).map((role) => (
              <label key={role} className="option-card">
                <input type="radio" name="role" value={role} checked={f.role === role} onChange={() => setF({ ...f, role })} />
                <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
                <span><b>{role === "restaurant" ? "飲食店" : "生産者"}</b><small>{role === "restaurant" ? "食材を仕入れる" : "育てた野菜を出品する"}</small></span>
              </label>
            ))}
          </div>
          {errorFor("role")}
        </fieldset>
        <label className="field">
          <span className="label">メールアドレス</span>
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" autoCapitalize="none" inputMode="email" aria-required="true" aria-invalid={error?.field === "email"} />
          {errorFor("email")}
        </label>
        <label className="field">
          <span className="label">パスワード（8文字以上）</span>
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" aria-required="true" aria-invalid={error?.field === "password"} />
          {errorFor("password")}
        </label>
        <label className="field">
          <span className="label">パスワード（確認のためもう一度）</span>
          <input type="password" value={f.passwordConfirm} onChange={(e) => setF({ ...f, passwordConfirm: e.target.value })} autoComplete="new-password" aria-required="true" aria-invalid={error?.field === "passwordConfirm"} />
          {errorFor("passwordConfirm")}
        </label>
        <div className="legal-links" data-field="legal">
          <p className="hint">登録の前に、内容をご確認ください（新しいタブで開きます）。</p>
          <a className="text-btn link-btn" href={PATHS.terms} target="_blank" rel="noopener">利用規約を読む<Icon name="chevronRight" /></a>
          <a className="text-btn link-btn" href={PATHS.privacy} target="_blank" rel="noopener">プライバシーポリシーを読む<Icon name="chevronRight" /></a>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={f.legalAccepted} onChange={(e) => setF({ ...f, legalAccepted: e.target.checked })} />
          <span>利用規約とプライバシーポリシーに同意する</span>
        </label>
        {errorFor("legal")}
        {error && !error.field && <div className="alert bad" role="alert"><Icon name="alert" />{error.text}</div>}
        <button type="submit" className="btn-primary btn-block" disabled={busy} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />登録しています…</> : "登録する"}
        </button>
      </form>
      <p className="guest-switch">登録済みの方は <Link to={PATHS.login}>ログイン</Link></p>
    </main>
  );
}
