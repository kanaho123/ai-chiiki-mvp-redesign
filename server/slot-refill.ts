import { prisma } from "./db.js";
import { ensureUpcomingSlots } from "./general-master.js";

// 受渡の回の補充（一般ユーザー向けの環境だけ）。受渡枠を使う画面の読み込み時に呼ぶ。
// 同じサーバーのインスタンスでは10分に1回まで。失敗しても画面の処理は止めない（次の呼び出しでもう一度試す）。
// 運営用の seed-general-master（npm run db:seed-general-master）でも同じ処理を実行できる。
const INTERVAL_MS = 10 * 60_000;
let lastRun = 0;

export async function refillSlotsIfDue(now = new Date()) {
  if (process.env.APP_MODE?.trim() !== "general") return;
  if (Date.now() - lastRun < INTERVAL_MS) return;
  lastRun = Date.now();
  try {
    await ensureUpcomingSlots(prisma, now);
  } catch (e) {
    lastRun = 0;
    console.error("SlotRefillError", e instanceof Error ? e.name : "");
  }
}

/** テスト用：間隔の記録を消す */
export const resetSlotRefillTimer = () => { lastRun = 0; };
