import { jstDate } from "../../src/lib/dates.js";
import { parsePlanRequest } from "../../src/lib/validate.js";
import { requireRole } from "../auth.js";
import { serverNow } from "../clock.js";
import { handle, json, readJson } from "../http.js";
import { planOptions } from "../plan-options.js";

// 受け取り場所（と、決めていなければ受け取り日）を決めずに「おすすめの受け取り方」を探す（飲食店だけ）。条件の確認は /api/plan と同じ規則。
// 受け取り場所（slotId）だけは不要。返すのは並べた案の一覧で、どれかを選んだら既存の /api/plan で計算し直す。
const PLACEHOLDER_SLOT = "auto-slot";

export const POST = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const now = serverNow();
  const body = (await readJson(request)) as Record<string, unknown> | null;
  // 受け取り日は任意（空なら未定。受け取れる回の中から探し、その回の日で計算する）。ほかの条件は /api/plan と同じ規則で確かめる
  const openDate = !body || body.desiredDate === undefined || body.desiredDate === null || body.desiredDate === "";
  const parsed = parsePlanRequest({ ...(body ?? {}), slotId: PLACEHOLDER_SLOT, ...(openDate && { desiredDate: jstDate(0, now) }) }, now);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { slotId: _ignored, ...req } = parsed.value;
  return json({ options: await planOptions({ ...req, desiredDate: openDate ? null : req.desiredDate }, g.user.id, now) });
});
