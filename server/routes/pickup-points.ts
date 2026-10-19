import { parseExistingPlace, parsePickupPoint } from "../../src/lib/pickup.js";
import { appMode } from "../app-mode.js";
import { requireRole } from "../auth.js";
import { serverNow } from "../clock.js";
import { prisma } from "../db.js";
import { handle, json, readJson } from "../http.js";
import { OnboardingProblem } from "../onboarding.js";
import { createPickupPoint, listMyPickupPoints, placeCandidates, usualPlaces, useExistingPlace } from "../pickup-points.js";

// 生産者本人の「いつもの受け渡し場所」：一覧（GET）と登録（POST）。一般ユーザー向けの環境で、登録を終えた生産者だけ。
// POST は2通り：新しい場所（名前・住所・種類・曜日・時間）／すでにある場所で「ここで渡せる」（placeId・曜日・時間）
// 別サイトからの登録は requireRole（requireUser）で拒否する。
export const GET = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  const producerId = g.user.producer!.id;
  const [points, usual, candidates] = await Promise.all([listMyPickupPoints(prisma, producerId), usualPlaces(prisma, producerId), placeCandidates(prisma, producerId)]);
  return json({ points, usual, candidates });
});

export const POST = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  const body = await readJson(request);
  const existing = body && typeof body === "object" && "placeId" in body;
  try {
    let created: unknown;
    if (existing) {
      const p = parseExistingPlace(body);
      if (!p.ok) return json({ error: p.error, field: p.field }, 400);
      created = await useExistingPlace(prisma, g.user.id, p.value, serverNow());
    } else {
      const p = parsePickupPoint(body);
      if (!p.ok) return json({ error: p.error, field: p.field }, 400);
      created = await createPickupPoint(prisma, g.user.id, p.value, serverNow());
    }
    const producerId = g.user.producer!.id;
    return json({ created, points: await listMyPickupPoints(prisma, producerId), usual: await usualPlaces(prisma, producerId) }, 201);
  } catch (e) {
    if (e instanceof OnboardingProblem) return json({ error: e.message }, e.status);
    throw e;
  }
});
