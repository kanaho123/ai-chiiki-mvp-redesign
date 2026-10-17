/**
 * このアプリ固有のモチーフ「束ねる線」：3本の線が1本に合流する。
 * ロゴ（Icon.tsx の Logo）・読み取り中・結果の束ね図で同じ形を使う。
 * flowing のときは線の上を短い破線が合流点へ流れる（約0.8秒のループ）。動きを減らす設定では静止する（CSS 側）。
 */
export function MergeMark({ flowing = false, className = "" }: { flowing?: boolean; className?: string }) {
  return (
    <svg className={`merge-mark ${flowing ? "is-flowing" : ""} ${className}`} viewBox="0 0 120 48" aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round">
        <path className="merge-in" d="M4 6c34 0 40 18 70 18M4 24h70M4 42c34 0 40-18 70-18" />
        <path className="merge-out" d="M74 24h42" />
      </g>
    </svg>
  );
}
