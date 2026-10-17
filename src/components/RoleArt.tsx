/**
 * 入口（役割選択）だけで使う、このアプリ独自のフラットイラスト。
 * 線ではなく「面」で描き、同じ系統の濃淡（緑：900/600/500/200、オレンジ：800/600/300）で奥行きを出す。
 * 一般的な操作アイコンは Icon.tsx の統一セットを使い、ここには世界観を作る絵だけを置く。
 * 画面の端で切れる前提の構図（親要素で overflow: hidden）。
 */
const CREAM = "#f6efe0";
const CREAM_WARM = "#fff3e6";
const YELLOW = "#f2c94c";

/** 飲食店の世界：庇のある店先と、野菜の入った木箱 */
export function RestaurantArt() {
  return (
    <svg viewBox="0 0 260 220" aria-hidden="true" focusable="false">
      {/* 店の建物（奥） */}
      <rect x="70" y="34" width="200" height="200" fill="var(--g600)" />
      <rect x="70" y="34" width="200" height="16" fill="var(--g900)" />
      {/* 庇：縞と丸い裾 */}
      <rect x="60" y="50" width="210" height="30" fill={CREAM} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={60 + i * 28} y="50" width="14" height="30" fill="var(--g500)" />)}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((i) => (
        <circle key={i} cx={67 + i * 14} cy="80" r="7" fill={i % 2 === 0 ? "var(--g500)" : CREAM} />
      ))}
      {/* 窓と扉 */}
      <rect x="92" y="106" width="74" height="54" rx="5" fill="var(--g200)" />
      <rect x="127" y="106" width="4" height="54" fill="var(--g600)" />
      <rect x="92" y="131" width="74" height="4" fill="var(--g600)" />
      <rect x="186" y="106" width="44" height="120" rx="3" fill="var(--g900)" />
      <rect x="219" y="160" width="4" height="12" rx="2" fill="var(--g200)" />
      {/* 木箱と野菜（店先の右手前。左側は文字のために空けておく） */}
      <circle cx="170" cy="164" r="17" fill="var(--g200)" />
      <circle cx="170" cy="164" r="9" fill="var(--g500)" />
      <circle cx="204" cy="158" r="20" fill={YELLOW} />
      <circle cx="238" cy="166" r="15" fill="var(--g200)" />
      <path d="M238 154v24M230 160l8 6l8-6" stroke="var(--g500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M204 138c-6-8-2-15 4-17c1 7-1 12-4 17z" fill="var(--g500)" />
      <rect x="146" y="172" width="120" height="56" rx="6" fill={CREAM} />
      <rect x="146" y="188" width="120" height="6" fill="var(--g200)" />
      <rect x="146" y="207" width="120" height="6" fill="var(--g200)" />
    </svg>
  );
}

/** 生産者の世界：重なる畑と畝（左下から右上へ）、芽、収穫箱 */
export function ProducerArt() {
  return (
    <svg viewBox="0 0 300 200" aria-hidden="true" focusable="false">
      {/* 奥の丘 */}
      <path d="M0 92C70 62 150 66 210 82S290 84 300 76V200H0Z" fill="var(--o600)" />
      {/* 手前の畑 */}
      <path d="M0 132C100 104 200 108 300 120V200H0Z" fill="var(--o800)" />
      {/* 畝：左下から右上へ流れる */}
      <path d="M6 200L120 116M56 200L150 114M112 200L182 114M172 200L214 118M232 200L246 122" stroke="var(--o600)" strokeWidth="9" strokeLinecap="round" />
      {/* 芽（奥の丘の上） */}
      <path d="M246 82V66" stroke={CREAM_WARM} strokeWidth="4" strokeLinecap="round" />
      <path d="M246 70c-10-1-16-8-16-16c10 0 16 7 16 16z" fill={CREAM_WARM} />
      <path d="M246 66c8-1 13-7 13-14c-8 0-13 6-13 14z" fill={CREAM_WARM} />
      <path d="M220 86V76" stroke={CREAM_WARM} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M220 79c-7-1-11-5-11-11c7 0 11 5 11 11z" fill={CREAM_WARM} />
      <path d="M220 77c6-1 9-5 9-10c-6 0-9 4-9 10z" fill={CREAM_WARM} />
      {/* 収穫箱と野菜（右手前） */}
      {/* 玉ねぎ（筋と先） */}
      <path d="M222 112c-2 4-1 6 0 7" stroke="#c9952a" strokeWidth="3" strokeLinecap="round" fill="none" />
      <circle cx="222" cy="134" r="15" fill={YELLOW} />
      <path d="M216 122c-4 7-4 17 0 24M228 122c4 7 4 17 0 24" stroke="#d8a531" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* トマト（へた） */}
      <circle cx="252" cy="131" r="17" fill="var(--o600)" />
      <path d="M252 116l3 5l6-2l-4 5l5 3l-6 1l-1 6l-3-5l-3 5l-1-6l-6-1l5-3l-4-5l6 2z" fill="var(--o800)" />
      {/* 人参（葉） */}
      <path d="M276 140l12-38l-22 8z" fill="var(--o300)" />
      <path d="M281 104c-2-8 0-13 5-15M284 106c4-6 9-8 14-6" stroke={CREAM_WARM} strokeWidth="3" strokeLinecap="round" fill="none" />
      <rect x="200" y="140" width="96" height="56" rx="6" fill={CREAM_WARM} />
      <rect x="200" y="157" width="96" height="6" fill="var(--o300)" />
      <rect x="200" y="176" width="96" height="6" fill="var(--o300)" />
    </svg>
  );
}

/** 矢印：独立したボタンではなく、短い説明に続く細い線（「束ねる線」と同じ線の太さ） */
export function LineArrow() {
  return (
    <svg className="line-arrow" viewBox="0 0 64 16" aria-hidden="true" focusable="false">
      <path d="M2 8h56M50 2l8 6-8 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
