// サービスの基準タイムゾーン（受渡の曜日・時刻はすべてこの地域の時刻として扱う）。
// OS・Vercel・DB のタイムゾーンには依存しない。日本は夏時間がないため、UTC との差は常に +09:00 として明示的に計算する。
// Date のローカル時刻系の関数（getHours / getDay など）は使わない。
export const SERVICE_TIMEZONE = "Asia/Tokyo";
const OFFSET_MS = 9 * 60 * 60_000;

export type JstDate = { y: number; m: number; d: number; weekday: number }; // weekday: 0=日〜6=土

/** ある瞬間の、Asia/Tokyo での年月日と曜日 */
export function jstDateOf(at: Date): JstDate {
  const t = new Date(at.getTime() + OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

/** Asia/Tokyo の年月日と "HH:MM" を、UTC の瞬間（Date）にする */
export function jstWallTime(date: { y: number; m: number; d: number }, hhmm: string): Date {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`時刻の形式が正しくありません（HH:MM）: ${hhmm}`);
  return new Date(Date.UTC(date.y, date.m - 1, date.d, Number(m[1]), Number(m[2])) - OFFSET_MS);
}

/** Asia/Tokyo の日付に days 日を足す */
export function addJstDays(date: { y: number; m: number; d: number }, days: number): JstDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d) + days * 86_400_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() };
}

export type SeriesTiming = { weekday: number; startTime: string; endTime: string; deadlineHours: number };
export type Occurrence = { startAt: Date; endAt: Date; confirmDeadlineAt: Date };

/**
 * 定期枠（曜日・時刻は Asia/Tokyo）から、now の翌日以降 days 日分の実際の回を作る。
 * 確認締切がすでに過ぎている回は作らない。
 */
export function upcomingOccurrences(series: SeriesTiming, now: Date, days: number): Occurrence[] {
  const today = jstDateOf(now);
  const out: Occurrence[] = [];
  for (let i = 1; i <= days; i++) {
    const day = addJstDays(today, i);
    if (day.weekday !== series.weekday) continue;
    const startAt = jstWallTime(day, series.startTime);
    const endAt = jstWallTime(day, series.endTime);
    if (endAt <= startAt) throw new Error(`終了時刻は開始時刻より後にしてください（${series.startTime}〜${series.endTime}）`);
    const confirmDeadlineAt = new Date(startAt.getTime() - series.deadlineHours * 60 * 60_000);
    if (confirmDeadlineAt <= now) continue;
    out.push({ startAt, endAt, confirmDeadlineAt });
  }
  return out;
}
