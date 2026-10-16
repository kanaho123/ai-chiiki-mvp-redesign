// 回数制限（サーバーのインスタンスごとのメモリ上の簡易的なもの。複数インスタンス間では共有しない）。

/** 一定時間内の失敗回数が上限に達したキーを、ロック期間のあいだ拒否する */
export class FailureLimiter {
  private entries = new Map<string, { failures: number; firstAt: number; lockedUntil: number }>();

  constructor(private maxFailures: number, private windowMs: number, private lockMs: number) {}

  isLocked(key: string, now = Date.now()): boolean {
    const e = this.entries.get(key);
    return !!e && e.lockedUntil > now;
  }

  fail(key: string, now = Date.now()): void {
    const e = this.entries.get(key);
    if (!e || now - e.firstAt > this.windowMs) {
      this.entries.set(key, { failures: 1, firstAt: now, lockedUntil: 0 });
      return;
    }
    e.failures++;
    if (e.failures >= this.maxFailures) e.lockedUntil = now + this.lockMs;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

/** 同じキーの呼び出しを最低間隔ごとに1回までにする */
export class IntervalLimiter {
  private last = new Map<string, number>();

  constructor(private minIntervalMs: number) {}

  /** 許可したら true（呼び出し時刻を記録する） */
  take(key: string, now = Date.now()): boolean {
    if (now - (this.last.get(key) ?? -Infinity) < this.minIntervalMs) return false;
    this.last.set(key, now);
    return true;
  }
}

/** リクエスト元の IP（Vercel では x-forwarded-for の先頭）。分からなければ "unknown" */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
}
