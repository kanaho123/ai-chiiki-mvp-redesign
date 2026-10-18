import { parsePlanRequest } from "../../src/lib/validate.js";
import { requireRole } from "../auth.js";
import { serverNow } from "../clock.js";
import { handle, json, readJson } from "../http.js";
import { planOptions } from "../plan-options.js";

// 受け取り場所を決めずに「おすすめの受け取り方」を探す（飲食店だけ）。条件の確認は /api/plan と同じ規則。
// 受け取り場所（slotId）だけは不要。返すのは並べた案の一覧で、どれかを選んだら既存の /api/plan で計算し直す。
const PLACEHOLDER_SLOT = "auto-slot";

export const POST = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const now = serverNow();
  const body = await readJson(request);
  const parsed = parsePlanRequest({ ...(body && typeof body === "object" ? body : {}), slotId: PLACEHOLDER_SLOT }, now);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { slotId: _ignored, ...req } = parsed.value;
  return json({ options: await planOptions(req, g.user.id, now) });
});
