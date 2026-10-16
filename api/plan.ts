import { allocatePlan } from "../src/lib/allocate.js";
import { suggestConditionChanges } from "../src/lib/suggest.js";
import { parsePlanRequest } from "../src/lib/validate.js";
import { isDemoClock, serverNow } from "../server/clock.js";
import { handle, json, readJson } from "../server/http.js";
import { loadPlanInputs, PHASE2_RESTAURANT_USER_ID } from "../server/plan-data.js";

// 確定済みの条件と最新の供給から、通常ロジックだけで仕入れ案を計算して返す（AI は使わない）。
// 案を作っても供給の数量は変更しない（在庫予約ではない）。
export const POST = handle(async (request) => {
  const now = serverNow();
  const parsed = parsePlanRequest(await readJson(request), now);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const req = parsed.value;

  // 計算のたびにサーバーで最新の供給を読み、同じ時点の version を返す（表示中の案が古いかの判定用）
  const { inputs, version } = await loadPlanInputs({ itemId: req.itemId, slotId: req.slotId, restaurantUserId: PHASE2_RESTAURANT_USER_ID });
  const plan = allocatePlan({ request: req, ...inputs, now });
  return json({ plan, version, request: req, suggestions: suggestConditionChanges(req, plan), demoClock: isDemoClock() });
});
