import { REQUEST_TEXT_MAX } from "../../lib/validate.js";
import { Icon } from "../../components/Icon";

// STEP 1：仕入れたい内容を文章で入力。手入力も選べる（自然文入力を強制しない）。

export const EXAMPLE_TEXT = "10月23日金曜に大阪産トマト10kg、受渡費込み8,000円以内。A農園を優先、初回の農家もOK";

export function StepInput({ text, onText, onExtract, onManual, busy, aiAvailable, error, emptyHint }: {
  text: string; onText: (t: string) => void; onExtract: () => void; onManual: () => void; busy: boolean;
  aiAvailable: boolean | null; error: string | null; emptyHint: boolean;
}) {
  return (
    <form className="qform" onSubmit={(e) => { e.preventDefault(); onExtract(); }} aria-labelledby="step1-title">
      <h2 className="q-title" id="step1-title"><span className="step-no">1</span>仕入れたい内容を文章で入力</h2>
      <label className="field">
        <span className="label">希望（品目・数量・日付・予算・産地・優先したい取引先など）</span>
        <textarea
          rows={5}
          maxLength={REQUEST_TEXT_MAX}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={`例：${EXAMPLE_TEXT}`}
          aria-describedby="step1-hint"
        />
        <span className="hint" id="step1-hint">{text.length.toLocaleString("ja-JP")} / {REQUEST_TEXT_MAX.toLocaleString("ja-JP")}文字。AIは文章から条件の候補を読み取るだけで、農家・数量・金額は決めません。</span>
      </label>

      {emptyHint && (
        <div className="alert warn" role="status">
          <Icon name="info" />
          <div>
            文章が空です。例文を使うか、手入力で指定してください。
            <button type="button" className="ghost" onClick={() => onText(EXAMPLE_TEXT)} style={{ paddingLeft: 0 }}>例文を入れる</button>
          </div>
        </div>
      )}
      {aiAvailable === false && (
        <div className="alert warn" role="status"><Icon name="info" />AIによる読み取りは現在使えません。手入力で指定してください（計算結果は同じです）。</div>
      )}
      {error && (
        <div className="alert bad" role="alert">
          <Icon name="alert" />
          <div>
            {error}
            <div className="qform-tools" style={{ marginTop: 8 }}>
              <button type="button" className="secondary" onClick={onManual}>手入力で指定する</button>
              <button type="button" className="ghost" onClick={onExtract} disabled={busy}>もう一度読み取る</button>
            </div>
          </div>
        </div>
      )}

      <button type="submit" className="primary large block" disabled={busy || aiAvailable === false} aria-busy={busy}>
        {busy ? <><span className="spinner" aria-hidden="true" />読み取り中…</> : "条件を整理する"}
      </button>
      <button type="button" className="ghost block" onClick={onManual}>手入力で指定する</button>
      {!text && <button type="button" className="ghost block" onClick={() => onText(EXAMPLE_TEXT)}>例文を入れる</button>}
    </form>
  );
}
