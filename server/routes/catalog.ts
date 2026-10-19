import { requireRole } from "../auth.js";
import { loadCatalog, publicCatalog } from "../catalog.js";
import { isDemoClock, serverNow } from "../clock.js";
import { openAiConfig } from "../ai/openai.js";
import { handle, json } from "../http.js";
import { refillSlotsIfDue } from "../slot-refill.js";

// 条件確認画面で使う登録データ。飲食店ユーザーだけ。aiAvailable は AI 抽出を使えるか（キーの値は返さない）。受け渡しの場所の住所は返さない
export const GET = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  await refillSlotsIfDue(); // これからの受渡の回が足りなければ補充（一般向けの環境だけ）
  const catalog = await loadCatalog(g.user.id);
  return json({ ...publicCatalog(catalog), now: serverNow().toISOString(), demoClock: isDemoClock(), aiAvailable: openAiConfig() !== null });
});
