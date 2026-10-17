import { useEffect, useRef, useState } from "react";
import type { Me } from "../App";
import { Icon } from "../components/Icon";

type DemoAccount = { loginId: string; displayName: string; role: "restaurant" | "producer" };

// デモ用ユーザーのログイン。デモ環境ではログイン名の候補を表示する（パスワードは表示・保存しない）。
export default function Login({ onLoggedIn }: { onLoggedIn: (me: Me) => void }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/demo-accounts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => setAccounts(d.accounts ?? []))
      .catch(() => {});
  }, []);

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
    <div className="page">
      <header className="page-head">
        <h1>ログイン</h1>
        <p className="lead">飲食店の方は仕入れ案の作成、生産者の方は自分の供給の確認・数量変更ができます。</p>
      </header>

      {accounts.length > 0 && (
        <section className="card" aria-labelledby="demo-title">
          <h2 className="card-title" id="demo-title">デモ用アカウント</h2>
          <p className="hint">選ぶとログイン名が入ります。パスワードはデモ担当者に確認してください。</p>
          <div className="account-list" role="group" aria-labelledby="demo-title">
            {accounts.map((a) => (
              <button
                key={a.loginId}
                type="button"
                className="account"
                aria-pressed={loginId === a.loginId}
                onClick={() => {
                  setLoginId(a.loginId);
                  setTimeout(() => passwordRef.current?.focus(), 0);
                }}
              >
                <Icon name={a.role === "restaurant" ? "store" : "box"} />
                <span className="account-name"><b>{a.displayName}</b><small>{a.loginId}</small></span>
                <span className={`chip ${a.role === "restaurant" ? "chip-restaurant" : "chip-producer"}`}>{a.role === "restaurant" ? "飲食店" : "生産者"}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <form className="card" onSubmit={submit} aria-label="ログイン">
        <label className="field">
          <span className="label">ログイン名</span>
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoCapitalize="none" aria-required="true" />
        </label>
        <label className="field">
          <span className="label">パスワード</span>
          <input ref={passwordRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-required="true" />
        </label>
        {error && <div className="alert bad" role="alert"><Icon name="alert" />{error}</div>}
        <button type="submit" className="primary large block" disabled={busy || !loginId || !password} aria-busy={busy}>
          {busy ? <><span className="spinner" aria-hidden="true" />確認中…</> : "ログイン"}
        </button>
      </form>

      <p className="home-about">このページはデモです。表示される農家・在庫・価格はすべて架空のデータで、注文確定・在庫の確保・決済・配送は行いません。</p>
    </div>
  );
}
