import { requireRole } from "../server/auth.js";
import { handle, json } from "../server/http.js";
import { loadPlanInputs } from "../server/plan-data.js";

// 表示中の案の計算に使ったデータ（供給の id・version・公開状態、枠、参加確認、取引経験）の現在の版を返す。
// 使い方: GET /api/inventory-version?itemId=...&slotId=...
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const GET = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const url = new URL(request.url);
  const itemId = url.searchParams.get("itemId") ?? "";
  const slotId = url.searchParams.get("slotId") ?? "";
  if (!ID.test(itemId) || !ID.test(slotId)) return json({ error: "品目と受渡枠を指定してください" }, 400);
  const { version } = await loadPlanInputs({ itemId, slotId, restaurantUserId: g.user.id });
  return json({ version });
});
