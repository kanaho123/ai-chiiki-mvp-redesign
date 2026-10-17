import { REQUEST_TEXT_MAX } from "../../lib/validate.js";
import { Icon } from "../../components/Icon";

// STEP 1：仕入れたい内容を普段の言葉で入力。項目を選んで入力することもできる（自然文入力を強制しない）。
// 読み取り中は1画面の待機表示（実際の進み具合は示さない控えめな演出）。

export const EXAMPLE_TEXT = "10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK";
// 例文チップ（品目を必ず含める）。押すと入力欄に入る
const EXAMPLES = [
  { label: "大阪産トマトを10kg", text: "大阪産トマトを10kg" },
  { label: "A農園を優先してトマト10kg", text: "A農園を優先してトマト10kg" },
  { label: "デモの例文", text: EXAMPLE_TEXT },
];

export function StepInput({ text, onText, onExtract, onManual, busy, aiAvailable, error, emptyHint }: {
  text: string; onText: (t: string) => void; onExtract: () => void; onManual: () => void; busy: boolean;
  aiAvailable: boolean | null; error: string | null; emptyHint: boolean;
}) {
  if (busy) {
    return (
      <section className="loading" role="status" aria-live="polite" aria-labelledby="loading-title">
        <div className="loading-art" aria-hidden="true">
          <span className="loading-core"><Icon name="sparkle" size={48} strokeWidth={1.5} /></span>
        </div>
        <h2 className="loading-title" id="loading-title">希望条件を整理しています</h2>
        <p className="lede">AIは条件を読み取るだけです</p>
        <p className="muted small">最大10秒ほどかかります</p>
        <button type="button" className="btn-link" onClick={onManual}>待たずに手入力する</button>
      </section>
    );
  }

  const aiOff = aiAvailable === false;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onExtract(); }} aria-labelledby="step1-title" style={{ display: "grid", gap: "var(--gap)" }}>
      <div className="title-block">
        <p className="eyebrow">仕入れ案をつくる</p>
        <h1 className="display" id="step1-title"><span className="nowrap">今日は何を</span><span className="nowrap">仕入れたいですか？</span></h1>
        <p className="lede">普段どおりの言葉で入力してください。</p>
      </div>

      <div className="composer">
        <label>
          <span className="sr-only">仕入れたい内容</span>
          <textarea rows={4} maxLength={REQUEST_TEXT_MAX} value={text} onChange={(e) => onText(e.target.value)}
            placeholder={`例：${EXAMPLE_TEXT}`} aria-describedby="step1-count" />
        </label>
        <div className="composer-foot"><span id="step1-count">{text.length.toLocaleString("ja-JP")} / {REQUEST_TEXT_MAX.toLocaleString("ja-JP")}</span></div>
      </div>

      <div className="example-chips" role="group" aria-label="例文（押すと入力欄に入ります）">
        {EXAMPLES.map((ex) => <button key={ex.label} type="button" className="example-chip example" onClick={() => onText(ex.text)}>{ex.label}</button>)}
      </div>

      <p className="ai-note"><Icon name="sparkle" size={18} />AIは言葉を整理するだけです。数量・価格・受渡条件は、確認したあと登録情報をもとにプログラムが計算します。</p>

      {emptyHint && <div className="alert warn" role="status"><Icon name="info" />文章が空です。例文を押すか、「項目を選んで入力」を使ってください。</div>}
      {aiOff && <div className="alert info" role="status"><Icon name="info" />AIによる読み取りは現在使えません。項目を選んで入力してください（計算結果は同じです）。</div>}
      {error && (
        <div className="alert bad" role="alert">
          <Icon name="alert" />
          <div>
            {error}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={onManual}>項目を選んで入力</button>
              <button type="button" className="btn-link" onClick={onExtract}>もう一度読み取る</button>
            </div>
          </div>
        </div>
      )}

      <div className="bottom-bar">
        <div className="bottom-bar-inner">
          {aiOff ? (
            <button type="button" className="btn-primary btn-block" onClick={onManual}>項目を選んで入力<Icon name="arrowRight" /></button>
          ) : (
            <>
              <button type="submit" className="btn-primary btn-block">条件を整理する<Icon name="arrowRight" /></button>
              <button type="button" className="btn-link btn-block" onClick={onManual}>項目を選んで入力</button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
