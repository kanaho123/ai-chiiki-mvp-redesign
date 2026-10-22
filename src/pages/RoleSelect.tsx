import { useEffect, useRef, useState } from "react";
import type { Me } from "../App";
import { Icon } from "../components/Icon";
import { LineArrow, ProducerArt, RestaurantArt } from "../components/RoleArt";

// サービスのトップ：役割を選ぶ → 下から出るシートでログイン（新規登録はない）。
// デモ環境ではその役割のデモ用アカウントを候補に出す（パスワードは表示・保存しない）。

type Role = "restaurant" | "producer";
type DemoAccount = { loginId: string; displayName: string; role: Role };
const ROLE_TEXT: Record<Role, string> = { restaurant: "飲食店", producer: "生産者" };
const ROLE_DESC: Record<Role, string> = { restaurant: "食材を仕入れる", producer: "今日出せる量を登録する" };

/** 役割のカード（飲食店・生産者）。画面全体を「飲食店の世界」と「生産者の世界」に分ける（面積は対等）。世界全体が1つのボタン */
export function RoleCards({ onPick, names = ROLE_TEXT, descs = ROLE_DESC }: {
  onPick: (role: Role) => void; names?: Record<Role, string>; descs?: Record<Role, string>;
}) {
  return (
    <div className="role-cards">
      {(["restaurant", "producer"] as const).map((role) => (
        <section key={role} className={`role-card ${role}`} aria-labelledby={`role-${role}`}>
          <button type="button" onClick={() => onPick(role)} aria-describedby={`role-${role}-desc`}>
            <span className="role-inner">
              <span className="role-art">{role === "restaurant" ? <RestaurantArt /> : <ProducerArt />}</span>
              <span className="role-text">
                <span className="role-name" id={`role-${role}`}>{names[role]}</span>
                <span className="role-line">
                  <span className="role-desc" id={`role-${role}-desc`}>{descs[role]}</span>
                  <span className="role-go" aria-hidden="true"><LineArrow /></span>
                </span>
              </span>
            </span>
          </button>
        </section>
      ))}
    </div>
  );
}

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
    <main className="screen role-screen">
      <h1 className="role-question">どちらで使いますか？</h1>

      <RoleCards onPick={setSheet} />

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
        <p className="sheet-note"><Icon name="info" size={18} />農家・在庫・価格はすべて架空のデモデータです。注文・在庫の確保・支払い・配送はしません。</p>
      </form>
    </div>
  );
}
