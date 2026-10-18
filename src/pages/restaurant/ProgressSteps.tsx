import { Icon } from "../../components/Icon";
import { consultationProgress, consultationStatus, type Confirmation } from "../../lib/approvals";
import { useSession } from "../../routes/session";

// 相談の進み具合（相談送信済み → 生産者回答待ち → マッチ成立 → 受け渡し待ち）。既存の依頼の状態から決めるだけで、新しい状態は保存しない。
// 条件が変わった・対応できない農家がいる相談では出さない（従来どおりの状態のタグと案内を使う）。
// 表示するのは、すでに進んだ段階と今の段階だけ（全農家が「対応できます」になるまで「マッチ成立」の言葉は出さない）。

/** 狭い画面で単語の途中で折り返さないよう、意味のまとまりで区切る（各まとまりの中では改行しない。幅があれば1行に並ぶ） */
const LABEL_PARTS: Record<string, string[]> = {
  sent: ["相談", "送信済み"], answer: ["生産者", "回答待ち"], matched: ["マッチ", "成立"], handover: ["受け渡し", "待ち"],
};

/** 画面の「いま」：デモ用の環境では固定の日時、一般向けでは現在時刻 */
export function useNow(): Date {
  const { demoNow } = useSession();
  return demoNow ? new Date(demoNow) : new Date();
}

export function progressOf(farms: Confirmation[], now: Date) {
  if (farms.length === 0) return null;
  const first = [...farms].sort((a, b) => a.pickupStartAt.localeCompare(b.pickupStartAt))[0];
  return consultationProgress({ status: consultationStatus(farms), farms, pickupStartAt: first.pickupStartAt }, now);
}

export function ProgressSteps({ farms, compact = false }: { farms: Confirmation[]; compact?: boolean }) {
  const now = useNow();
  const p = progressOf(farms, now);
  if (!p) return null;
  if (compact) return <span className="consult-next">{p.current}</span>;
  const shown = p.steps.filter((s) => s.state !== "todo");
  return (
    <div className="progress-steps">
      <ol aria-label="相談の進み具合" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((s) => (
          <li key={s.key} className={`progress-step ${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="progress-dot" aria-hidden="true">{s.state === "done" ? <Icon name="check" size={16} strokeWidth={3} /> : null}</span>
            <span className="progress-label">{(LABEL_PARTS[s.key] ?? [s.label]).map((part) => <span key={part} className="progress-label-part">{part}</span>)}</span>
          </li>
        ))}
      </ol>
      <p className="progress-current" role="status">いま：{p.current}</p>
    </div>
  );
}
