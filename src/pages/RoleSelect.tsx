import { useEffect, useRef, useState } from "react";
import type { Me } from "../App";
import { Icon } from "../components/Icon";

// サービスのトップ：役割を選ぶ → 下から出るシートでログイン（新規登録はない）。
// デモ環境ではその役割のデモ用アカウントを候補に出す（パスワードは表示・保存しない）。

type Role = "restaurant" | "producer";
type DemoAccount = { loginId: string; displayName: string; role: Role };
const ROLE_TEXT: Record<Role, string> = { restaurant: "飲食店", producer: "生産者" };

export default function RoleSelect({ onLoggedIn }: { onLoggedIn: (me: Me) => void }) {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [sheet, setSheet] = useState<Role | null>(null);

  useEffect(() => {
    fetch("/api/auth/demo-accounts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => setAccounts(d.accounts ?? []))
      .catch(() => {});
  }, []);

  return (
    <main className="screen">
      <h1 className="display">どちらで使いますか？</h1>

      {/* 役割の入口：アイコン＋役割名＋1行。役割の色で塗ったカード全体が1つのボタン */}
      <div className="role-cards">
        <section className="role-card restaurant" aria-labelledby="role-r">
          <button type="button" onClick={() => setSheet("restaurant")} aria-describedby="role-r-desc">
            <span className="role-icon" aria-hidden="true"><Icon name="store" size={30} strokeWidth={1.8} /></span>
            <span className="role-name" id="role-r">飲食店</span>
            <span className="role-desc" id="role-r-desc">食材を仕入れる</span>
          </button>
        </section>
        <section className="role-card producer" aria-labelledby="role-p">
          <button type="button" onClick={() => setSheet("producer")} aria-describedby="role-p-desc">
            <span className="role-icon" aria-hidden="true"><Icon name="sprout" size={30} strokeWidth={1.8} /></span>
            <span className="role-name" id="role-p">生産者</span>
            <span className="role-desc" id="role-p-desc">出せる量を登録</span>
          </button>
        </section>
      </div>

      <p className="about-line"><Icon name="info" size={18} />農家・在庫・価格はすべて架空です。注文や支払いはしません。</p>

      {sheet && (
        <LoginSheet role={sheet} accounts={accounts.filter((a) => a.role === sheet)} onClose={() => setSheet(null)} onLoggedIn={onLoggedIn} />
      )}
    </main>
  );
}

function LoginSheet({ role, accounts, onClose, onLoggedIn }: {
  role: Role; accounts: DemoAccount[]; onClose: () => void; onLoggedIn: (me: Me) => void;
}) {
  const [loginId, setLoginId] = useState(accounts.length === 1 ? accounts[0].loginId : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginId, password }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? "ログイン情報を確認してください");
        return;
      }
      setPassword("");
      onLoggedIn(d.user);
    } catch {
      setError("通信に失敗しました。もう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className={`sheet role-${role}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title" aria-label="ログイン" onSubmit={submit}>
        <div className="sheet-head">
          <h2 id="sheet-title">{ROLE_TEXT[role]}の方のログイン</h2>
          <button type="button" ref={firstRef} className="sheet-close" onClick={onClose} aria-label="閉じる"><Icon name="x" size={24} /></button>
        </div>

        {accounts.length > 0 ? (
          <fieldset className="option-cards" aria-label="デモ用アカウント">
            {accounts.map((a) => (
              <label key={a.loginId} className="option-card">
                <input type="radio" name="account" value={a.loginId} checked={loginId === a.loginId}
                  onChange={() => { setLoginId(a.loginId); setTimeout(() => passwordRef.current?.focus(), 0); }} />
                <span className="tick" aria-hidden="true"><Icon name="check" size={16} /></span>
                <span><b>{a.displayName}</b><small>デモ用のアカウント（{a.loginId}）</small></span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="field" style={accounts.length > 0 ? { display: "none" } : undefined}>
          <span className="label">ログイン名</span>
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoCapitalize="none" aria-required="true" />
        </label>
        <label className="field">
          <span className="label">パスワード<span className="req">必須</span></span>
          <input ref={passwordRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-required="true" />
          {accounts.length > 0 && <span className="hint">パスワードは、デモの担当者に確認してください。</span>}
        </label>
        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
        <button type="submit" className="btn-primary btn-block" disabled={busy || !loginId || !password} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />確認しています…</> : "ログイン"}
        </button>
      </form>
    </div>
  );
}
