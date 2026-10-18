import { useState } from "react";
import { Icon } from "../../components/Icon";

/** 読み込みの失敗：何が起きたかと、次にできること（もう一度読み込む）を出す */
export function ErrorRetry({ text, onRetry }: { text: string; onRetry: () => unknown }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="alert bad error-retry" role="alert">
      <Icon name="alert" />
      <div>
        <p>{text}</p>
        <button type="button" className="btn-secondary" disabled={busy} aria-busy={busy}
          onClick={async () => { setBusy(true); try { await onRetry(); } finally { setBusy(false); } }}>
          <Icon name="refresh" />もう一度読み込む
        </button>
      </div>
    </div>
  );
}
