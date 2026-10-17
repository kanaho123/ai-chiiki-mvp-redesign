import { REQUEST_TEXT_MAX } from "../../lib/validate.js";
import { BottomBar } from "../../components/BottomBar";
import { MergeMark } from "../../components/Motif";
import { Icon, type IconName } from "../../components/Icon";

// STEP 1：仕入れたい内容を普段の言葉で入力。項目を選んで入力することもできる（自然文入力を強制しない）。
// 読み取り中は1画面の待機表示（実際の進み具合は示さない控えめな演出）。

// 何を書けばいいかを目で示す4つの手がかり（押すと入力欄に加わる）。品目・量・産地・受け取り日
const HINTS: { icon: IconName; word: string; label: string }[] = [
  { icon: "basket", word: "トマト", label: "品目" },
  { icon: "weight", word: "10kg", label: "量" },
  { icon: "pin", word: "大阪産", label: "産地" },
  { icon: "calendar", word: "10/23 午前", label: "受け取り" },
];

export function StepInput({ text, onText, onExtract, onManual, busy, aiAvailable, error, emptyHint }: {
  text: string; onText: (t: string) => void; onExtract: () => void; onManual: () => void; busy: boolean;
  aiAvailable: boolean | null; error: string | null; emptyHint: boolean;
}) {
  if (busy) {
    return (
      <section className="loading" role="status" aria-live="polite" aria-labelledby="loading-title">
        <MergeMark flowing className="loading-mark" />
        <h2 className="loading-title" id="loading-title">文章を読み取っています</h2>
        <p className="loading-text">品目・数量・日付に整理しています（10秒ほど）</p>
        <button type="button" className="btn-secondary btn-block" onClick={onManual}>待たずに手入力する</button>
      </section>
    );
  }

  const aiOff = aiAvailable === false;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onExtract(); }} aria-labelledby="step1-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <div className="title-row">
        <h1 className="display" id="step1-title">何を仕入れますか？</h1>
        {!aiOff && <button type="button" className="text-btn manual-btn" onClick={onManual}><Icon name="edit" size={20} />項目で入力</button>}
      </div>

      {/* 主役は書く場所。AIの役割は下に1行だけ */}
      <div className="composer">
        <label>
          <span className="sr-only">仕入れたい内容</span>
          <textarea rows={4} maxLength={REQUEST_TEXT_MAX} value={text} onChange={(e) => onText(e.target.value)}
            placeholder="ここに書いてください" aria-describedby="step1-note" />
        </label>
        <div className="hint-tiles" role="group" aria-label="書く内容の例（押すと入力欄に加わります）">
          {HINTS.map((h) => (
            <button key={h.word} type="button" className={`hint-tile example-chip ${text.includes(h.word) ? "used" : ""}`}
              onClick={() => onText(text.includes(h.word) ? text : text.trim() ? `${text.trim()} ${h.word}` : h.word)}>
              <Icon name={text.includes(h.word) ? "check" : h.icon} size={20} /><span className="hint-word">{h.word}</span><span className="sr-only">（{h.label}）</span>
            </button>
          ))}
        </div>
        <p className="ai-note" id="step1-note">AIが品目・数量・日付を読み取ります</p>
        {text.length > REQUEST_TEXT_MAX * 0.8 && <span className="count">{text.length.toLocaleString("ja-JP")}/{REQUEST_TEXT_MAX.toLocaleString("ja-JP")}</span>}
      </div>

      {emptyHint && <div className="alert warn" role="status"><Icon name="info" />文章が空です。上の例を押すか、「項目で入力」を使ってください。</div>}
      {aiOff && <div className="alert info" role="status"><Icon name="info" />AIによる読み取りは現在使えません。項目を選んで入力してください（計算結果は同じです）。</div>}
      {error && (
        <div className="alert bad" role="alert">
          <Icon name="alert" />
          <div>
            {error}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={onManual}>項目を選んで入力</button>
              <button type="button" className="btn-secondary" onClick={onExtract}>もう一度読み取る</button>
            </div>
          </div>
        </div>
      )}

      <BottomBar>
        {aiOff ? (
          <button type="button" className="btn-primary btn-block" onClick={onManual}>項目を選んで入力<Icon name="arrowRight" /></button>
        ) : (
          <>
            <button type="submit" className="btn-primary btn-block">条件を整理する<Icon name="arrowRight" /></button>
          </>
        )}
      </BottomBar>
    </form>
  );
}
