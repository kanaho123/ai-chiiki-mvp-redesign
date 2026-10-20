import { parseItemName } from "../../src/lib/items.js";
import { appMode } from "../app-mode.js";
import { requireRole } from "../auth.js";
import { serverNow } from "../clock.js";
import { handle, json, readJson } from "../http.js";
import { suggestItems } from "../item-suggestions.js";
import { IntervalLimiter } from "../rate-limit.js";

// 飲食店が書いた品目名が登録されていないときの、近い食材の候補（飲食店だけ・一般向けの環境だけ・読み取りだけ）。
// 計算はしない。候補を選んだら、画面がその品目で今までの仕入れ案の流れ（/api/plan-options・/api/plan）へ進む。

// AI を呼ぶのは同じユーザーで1秒に1回まで（連打の防止。一致・出品なし・キャッシュのときは数えない）
const aiLimiter = new IntervalLimiter(1000);
const EMPTY = { match: null, suggestions: [], ai: "skipped", widened: false } as const;

export const POST = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  if (appMode() !== "general") return json({ error: "この環境では使えません" }, 404);
  const body = (await readJson(request)) as Record<string, unknown> | null;
  const name = parseItemName(body?.name);
  if (!name.ok) return json(EMPTY); // 品目名の形でなければ、AI に渡さず候補なし
  const desiredDate = typeof body?.desiredDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.desiredDate) ? body.desiredDate : null;
  const slotId = typeof body?.slotId === "string" && body.slotId.length > 0 && body.slotId.length <= 64 ? body.slotId : null;
  const r = await suggestItems(name.name, { desiredDate, slotId }, serverNow(), { allowAi: () => aiLimiter.take(g.user.id) });
  if (r === "rate_limited") return json({ error: "少し時間をおいてからもう一度お試しください" }, 429);
  return json(r);
});
