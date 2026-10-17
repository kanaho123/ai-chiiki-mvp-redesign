import { REQUEST_TEXT_MAX } from "../../lib/validate.js";
import { BottomBar } from "../../components/BottomBar";
import { Icon } from "../../components/Icon";

// STEP 1：仕入れたい内容を普段の言葉で入力。項目を選んで入力することもできる（自然文入力を強制しない）。
// 読み取り中は1画面の待機表示（実際の進み具合は示さない控えめな演出）。

export const EXAMPLE_TEXT = "10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK";
// 短い入力例（品目を必ず含める）。押すと入力欄に入る
const EXAMPLES = [
  { label: "トマト 10kg", text: "大阪産トマトを10kg" },
  { label: "A農園を優先", text: "A農園を優先してトマト10kg" },
  { label: "日付と予算も", text: EXAMPLE_TEXT },
];

export function StepInput({ text, onText, onExtract, onManual, busy, aiAvailable, error, emptyHint }: {
  text: string; onText: (t: string) => void; onExtract: () => void; onManual: () => void; busy: boolean;
  aiAvailable: boolean | null; error: string | null; emptyHint: boolean;
}) {
  if (busy) {
    return (
      <section className="loading" role="status" aria-live="polite" aria-labelledby="loading-title">
        <h2 className="loading-title" id="loading-title">文章を読み取っています</h2>
        <div className="loading-line" aria-hidden="true"><span /></div>
        <p>品目・数量・日付などを読み取っています。10秒ほどかかることがあります。</p>
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
            placeholder="例：10月23日に大阪産トマトを10kg" aria-describedby="step1-note" />
        </label>
        {text.length > REQUEST_TEXT_MAX * 0.8 && <span className="count">{text.length.toLocaleString("ja-JP")}/{REQUEST_TEXT_MAX.toLocaleString("ja-JP")}</span>}
      </div>
      <p className="ai-note" id="step1-note"><Icon name="edit" size={16} />AIが品目・数量・日付を読み取ります</p>

      <div className="example-list" role="group" aria-label="入力例（押すと入力欄に入ります）">
        <span className="example-title" aria-hidden="true">例</span>
        {EXAMPLES.map((ex) => <button key={ex.label} type="button" className="example-chip example" onClick={() => onText(ex.text)}>{ex.label}</button>)}
      </div>

      {emptyHint && <div className="alert warn" role="status"><Icon name="info" />文章が空です。例を押すか、「項目で入力」を使ってください。</div>}
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
