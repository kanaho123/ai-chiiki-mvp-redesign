import type { SVGProps } from "react";

/**
 * UI アイコン（自作。24px グリッド・線幅 1.8・角丸線で統一）。
 * 意味は必ず文字でも伝え、アイコンは補助として aria-hidden にする。
 */
const PATHS = {
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17.2v.1" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  // 飲食店（店舗の庇）
  store: (
    <>
      <path d="M4 9.5L5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20" />
    </>
  ),
  // 生産者・出品（箱）
  box: (
    <>
      <path d="M3.5 8L12 4l8.5 4v8.5L12 20.5 3.5 16.5V8z" />
      <path d="M3.5 8L12 12l8.5-4M12 12v8.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  pause: <path d="M9 6v12M15 6v12" />,
  // 仕入れ（かご）
  basket: (
    <>
      <path d="M4 10h16l-1.6 8.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 10z" />
      <path d="M8.5 10l3.5-5.5L15.5 10M9.5 14v2.5M14.5 14v2.5" />
    </>
  ),
  // 芽・農園
  sprout: (
    <>
      <path d="M12 20v-8" />
      <path d="M12 12C12 8 9.5 5.5 5 5.5c0 4 2.5 6.5 7 6.5z" />
      <path d="M12 14.5c0-3.5 2.3-6 6.5-6 0 3.6-2.3 6-6.5 6z" />
      <path d="M7 20h10" />
    </>
  ),
  // AI が言葉を整理する（きらめき）
  sparkle: (
    <>
      <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7L12 3.5z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </>
  ),
  // 注文ではない検討用の案（クリップボード）
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="2.5" />
      <path d="M9 4.5h6v2.5H9zM8.5 12l2.3 2.3 4.7-4.6" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6.5h11v9.5H3zM14 10h3.8l3.2 3.2V16h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  yen: <path d="M7 4.5l5 7.5 5-7.5M12 12v8M8 13h8M8 16.5h8" />,
  leaf: (
    <>
      <path d="M5 19c0-8 5-13.5 14-14 .2 9-5.5 14-14 14z" />
      <path d="M5 19c3-4 6-6.5 10-8.5" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
      <path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5-10-6.5z" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** サービスのシンボル：小さな出荷（3本）が1つの仕入れ案（右の1本）にまとまる形 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#2F5E45" />
      <rect x="7" y="9" width="8" height="3" rx="1.5" fill="#fff" />
      <rect x="7" y="14.5" width="6" height="3" rx="1.5" fill="#fff" />
      <rect x="7" y="20" width="4" height="3" rx="1.5" fill="#fff" />
      <path d="M16 10.5h3.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <rect x="22.5" y="14.5" width="3" height="3" rx="1.5" fill="#E9B48F" />
    </svg>
  );
}
