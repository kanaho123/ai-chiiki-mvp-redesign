import { REQUEST_TEXT_MAX } from "../../lib/validate.js";
import { Icon } from "../../components/Icon";

// STEP 1：仕入れたい内容を普段の言葉で入力。項目を選んで入力することもできる（自然文入力を強制しない）。

export const EXAMPLE_TEXT = "10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK";
const EXAMPLES = [
  { label: "例1", text: EXAMPLE_TEXT },
  { label: "例2", text: "10月23日に大阪産のトマトを10kg。予算は上限なし、取引のある農家だけで" },
];

export function StepInput({ text, onText, onExtract, onManual, busy, aiAvailable, error, emptyHint }: {
  text: string; onText: (t: string) => void; onExtract: () => void; onManual: () => void; busy: boolean;
  aiAvailable: boolean | null; error: string | null; emptyHint: boolean;
}) {
  // AI 読み取り中：何をしているか・どれくらいかかるか・待たずに手入力できることを示す（多重送信はしない）
  if (busy) {
    return (
      <section className="card ai-wait" role="status" aria-live="polite" aria-labelledby="ai-wait-title">
        <span className="spinner big" aria-hidden="true" />
        <p className="ai-wait-title" id="ai-wait-title">AIが希望条件を整理しています</p>
        <p className="hint">最大10秒ほどかかります。農家・数量・金額はAIではなく、確認後に登録データから計算します。</p>
        <p className="source-text muted">「{text}」</p>
        <button type="button" className="secondary block" onClick={onManual}>待たずに手入力する</button>
      </section>
    );
  }

  const aiOff = aiAvailable === false;
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onExtract(); }} aria-labelledby="step1-title">
      <h2 className="ask-title" id="step1-title">どんな食材を仕入れたいですか？</h2>
      <p className="hint">普段どおりの言葉で入力してください。AIが条件を整理し、確認してから仕入れ案を作ります。</p>

      <label className="field">
        <span className="sr-only">仕入れたい内容</span>
        <textarea
          rows={5}
          maxLength={REQUEST_TEXT_MAX}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={`例：${EXAMPLE_TEXT}`}
          aria-describedby="step1-hint"
        />
        <span className="hint" id="step1-hint">{text.length.toLocaleString("ja-JP")} / {REQUEST_TEXT_MAX.toLocaleString("ja-JP")}文字</span>
      </label>

      <div className="examples" role="group" aria-label="例文（押すと入力欄に入ります）">
        {EXAMPLES.map((ex) => (
          <button key={ex.label} type="button" className="example" onClick={() => onText(ex.text)}>
            <b>{ex.label}</b>{ex.text}
          </button>
        ))}
      </div>

      {emptyHint && <div className="alert warn" role="status"><Icon name="info" />文章が空です。例文を押すか、「項目を選んで入力する」を使ってください。</div>}
      {aiOff && <div className="alert info" role="status"><Icon name="info" />AIによる読み取りは現在使えません。項目を選んで入力してください（計算結果は同じです）。</div>}
      {error && (
        <div className="alert bad" role="alert">
          <Icon name="alert" />
          <div>
            {error}
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" className="primary" onClick={onManual}>項目を選んで入力する</button>
              <button type="button" className="ghost" onClick={onExtract}>もう一度読み取る</button>
            </div>
          </div>
        </div>
      )}

      <div className="actions">
        {aiOff ? (
          <button type="button" className="primary large block" onClick={onManual}>項目を選んで入力する</button>
        ) : (
          <>
            <button type="submit" className="primary large block">条件を整理する</button>
            <button type="button" className="ghost block" onClick={onManual}>項目を選んで入力する</button>
          </>
        )}
      </div>
    </form>
  );
}
