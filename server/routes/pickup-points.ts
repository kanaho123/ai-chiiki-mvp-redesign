import { parsePickupPoint } from "../../src/lib/pickup.js";
import { appMode } from "../app-mode.js";
import { requireRole } from "../auth.js";
import { serverNow } from "../clock.js";
import { prisma } from "../db.js";
import { handle, json, readJson } from "../http.js";
import { OnboardingProblem } from "../onboarding.js";
import { createPickupPoint, listMyPickupPoints } from "../pickup-points.js";

// 生産者本人の「受け渡し可能地点」：一覧（GET）と登録（POST）。一般ユーザー向けの環境で、登録を終えた生産者だけ。
// 別サイトからの登録は requireRole（requireUser）で拒否する。
export const GET = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  return json({ points: await listMyPickupPoints(prisma, g.user.producer!.id) });
});

export const POST = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  const parsed = parsePickupPoint(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error, field: parsed.field }, 400);
  try {
    const created = await createPickupPoint(prisma, g.user.id, parsed.value, serverNow());
    return json({ created, points: await listMyPickupPoints(prisma, g.user.producer!.id) }, 201);
  } catch (e) {
    if (e instanceof OnboardingProblem) return json({ error: e.message }, e.status);
    throw e;
  }
});
