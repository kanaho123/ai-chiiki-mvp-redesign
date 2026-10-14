import { createPlan } from "../src/lib/allocate.js";
import { jstDate } from "../src/lib/dates.js";
import { parsePlanRequest } from "../src/lib/validate.js";
import { inventoryVersion, loadListings } from "../server/db.js";
import { handle, json, readJson } from "../server/http.js";

// 仕入れ案を計算して返すだけで、在庫（出品の数量）は変更しない。
export const POST = handle(async (request) => {
  const parsed = parsePlanRequest(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  // 計算に使った出品と同じ時点の version を返す（表示中の案が古いかの判定用）
  const [listings, version] = await Promise.all([loadListings(), inventoryVersion()]);
  const plan = createPlan(parsed.value, listings, jstDate());
  return json({ plan, version, request: parsed.value });
});
