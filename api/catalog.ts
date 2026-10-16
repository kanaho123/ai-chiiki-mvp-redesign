import { requireRole } from "../server/auth.js";
import { loadCatalog } from "../server/catalog.js";
import { isDemoClock, serverNow } from "../server/clock.js";
import { openAiConfig } from "../server/ai/openai.js";
import { handle, json } from "../server/http.js";

// 条件確認画面で使う登録データ。飲食店ユーザーだけ。aiAvailable は AI 抽出を使えるか（キーの値は返さない）
export const GET = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const catalog = await loadCatalog(g.user.id);
  return json({ ...catalog, now: serverNow().toISOString(), demoClock: isDemoClock(), aiAvailable: openAiConfig() !== null });
});
