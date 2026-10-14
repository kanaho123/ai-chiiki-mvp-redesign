const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間での今日（YYYY-MM-DD）から days 日後の日付 */
export function jstDate(days = 0, now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS + days * 86400000).toISOString().slice(0, 10);
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** 2026-10-16 → 10月16日（金） */
export function formatDateJa(s: string): string {
  const d = new Date(`${s}T00:00:00Z`);
  const w = "日月火水木金土"[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${w}）`;
}
