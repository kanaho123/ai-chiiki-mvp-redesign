// AI 呼び出しの間隔制限（インスタンスごとのメモリ上の簡易的なもの。費用の暴走を抑える目的で、ログインの総当たり対策は DB 側）。

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
