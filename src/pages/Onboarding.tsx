import { useState } from "react";
import { Icon, type IconName } from "../components/Icon";

// 初回のみのオンボーディング（4画面）。見終わった・スキップしたことは端末内に記録する（App 側）。

type Slide = { title: string[]; text: string; icon: IconName; tone: "green" | "orange" };

const SLIDES: Slide[] = [
  { title: ["足りない仕入れを、", "地域の供給で補う"], icon: "basket", tone: "green",
    text: "1軒だけでは足りない量も、条件の合う地域の供給を組み合わせて1つの仕入れ案にまとめます。" },
  { title: ["飲食店は、", "欲しい条件を言葉で"], icon: "store", tone: "green",
    text: "『10月23日に大阪産トマトを10kg』のように入力するだけ。AIが条件を整理します。" },
  { title: ["生産者は、", "今日出せる量だけ更新"], icon: "sprout", tone: "orange",
    text: "販売できる量を、忙しいときでも数タップで更新できます。" },
  { title: ["仕入れ案は、", "まだ注文ではありません"], icon: "clipboard", tone: "green",
    text: "表示されるのは、生産者への確認前・在庫未確保の案です。実際の取引は、各生産者に確認してから進めてください。" },
];

const TONE = {
  green: { "--ob-color": "var(--color-restaurant)", "--ob-btn": "var(--color-restaurant-dark)" },
  orange: { "--ob-color": "var(--color-producer)", "--ob-btn": "var(--color-producer-dark)" },
} as const;

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <div className="ob" style={TONE[s.tone] as React.CSSProperties} aria-roledescription="オンボーディング">
      <div className="ob-top">
        <div className="ob-progress" role="progressbar" aria-valuemin={1} aria-valuemax={SLIDES.length} aria-valuenow={i + 1} aria-label="進み具合">
          <span style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} />
        </div>
        <span className="ob-count">{i + 1}/{SLIDES.length}</span>
        <button type="button" className="btn-quiet" onClick={onDone}>スキップ</button>
      </div>

      <div className="ob-body" aria-live="polite">
        <div className="ob-art" aria-hidden="true"><Icon name={s.icon} size={38} strokeWidth={1.5} /></div>
        <span className="ob-mark" aria-hidden="true" />
        <h1 className="ob-title">{s.title.map((l) => <span key={l} className="nowrap">{l}</span>)}</h1>
        <p className="ob-text">{s.text}</p>
      </div>

      <div className="ob-actions">
        <div className="ob-dots" aria-hidden="true">{SLIDES.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
        <button type="button" className="btn-primary btn-block" onClick={() => (last ? onDone() : setI(i + 1))}>
          {last ? "はじめる" : <>次へ<Icon name="arrowRight" /></>}
        </button>
      </div>
    </div>
  );
}
