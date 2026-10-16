// サーバーの「現在時刻」。デモ環境で DEMO_NOW が設定されていればその時刻を使う（隔離データでの固定デモ用）。
// 計算ロジックはこの値を引数で受け取り、Date.now() を直接使わない。

export function serverNow(env: Record<string, string | undefined> = process.env): Date {
  const demo = env.DEMO_NOW?.trim();
  if (!demo) return new Date();
  const d = new Date(demo);
  if (Number.isNaN(d.getTime())) throw new Error("DEMO_NOW の形式が正しくありません（例: 2026-10-22T12:00:00+09:00）");
  return d;
}

export const isDemoClock = (env: Record<string, string | undefined> = process.env) => !!env.DEMO_NOW?.trim();
