/**
 * 入口（役割選択）だけで使う、このアプリ独自の線画。
 * 一般的な操作アイコンは Icon.tsx の統一セットを使い、ここには「世界観を作る絵」だけを置く。
 * 線の色・面の色は親要素の CSS 変数（--art-line / --art-fill）で決める。
 */
const common = {
  fill: "none", stroke: "var(--art-line)", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round",
} as const;

/** 飲食店：庇のある店と、野菜の入った木箱 */
export function RestaurantArt() {
  return (
    <svg viewBox="0 0 200 150" aria-hidden="true" focusable="false" {...common}>
      <path d="M8 141h184" />
      {/* 店 */}
      <path d="M64 56v85h108V56" fill="var(--art-fill)" />
      <path d="M56 56l8-24h108l8 24" fill="var(--art-fill)" />
      <path d="M56 56q9 11 18 0q9 11 18 0q9 11 18 0q9 11 18 0q9 11 18 0q9 11 18 0q9 11 18 0" />
      <path d="M86 32l-4 24M108 32l-2 24M130 32l2 24M152 32l4 24" />
      <rect x="78" y="76" width="40" height="30" rx="3" />
      <path d="M78 91h40" />
      <rect x="132" y="88" width="28" height="53" rx="2" />
      <path d="M154 116v3" />
      {/* 木箱と野菜 */}
      <circle cx="27" cy="99" r="9" fill="var(--art-fill)" />
      <circle cx="47" cy="96" r="11" fill="var(--art-fill)" />
      <circle cx="66" cy="100" r="8" fill="var(--art-fill)" />
      <path d="M47 85l-5-6M47 85l5-6M27 90l-4-4M27 90l4-4" />
      <rect x="14" y="106" width="62" height="35" rx="3" fill="var(--art-fill)" />
      <path d="M14 118h62M14 129h62" />
    </svg>
  );
}

/** 生産者：畑の畝と芽、収穫箱 */
export function ProducerArt() {
  return (
    <svg viewBox="0 0 200 150" aria-hidden="true" focusable="false" {...common}>
      <path d="M8 141h184M20 70h160" />
      {/* 畝（奥にすぼまる） */}
      <path d="M14 141l58-71M58 141l34-71M104 141l8-71M150 141l-18-71" />
      {/* 芽 */}
      <path d="M84 70V52" />
      <path d="M84 60c-9-1-14-7-14-15c9 0 14 6 14 15z" fill="var(--art-fill)" />
      <path d="M84 56c7-1 12-6 12-13c-8 0-12 5-12 13z" fill="var(--art-fill)" />
      <path d="M122 70V58" />
      <path d="M122 63c-6-1-10-5-10-11c6 0 10 4 10 11z" fill="var(--art-fill)" />
      <path d="M122 60c5-1 8-4 8-9c-5 0-8 3-8 9z" fill="var(--art-fill)" />
      {/* 収穫箱と野菜 */}
      <circle cx="142" cy="99" r="9" fill="var(--art-fill)" />
      <circle cx="162" cy="96" r="11" fill="var(--art-fill)" />
      <path d="M180 104l6-24l-12 4z" fill="var(--art-fill)" />
      <path d="M162 85l-5-6M162 85l5-6M180 80l-2-7M180 80l5-5" />
      <rect x="128" y="106" width="62" height="35" rx="3" fill="var(--art-fill)" />
      <path d="M128 118h62M128 129h62" />
    </svg>
  );
}
