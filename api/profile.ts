import { checkProducer, checkRestaurant } from "../src/lib/onboarding.js";
import { appMode } from "../server/app-mode.js";
import { requireOnboardedUser } from "../server/auth.js";
import { prisma } from "../server/db.js";
import { handle, json, readJson } from "../server/http.js";
import { OnboardingProblem } from "../server/onboarding.js";
import { loadProfile, updateProducerProfile, updateRestaurantProfile } from "../server/profile.js";
import { repo } from "../server/repo.js";

// マイページ：本人のプロフィールの表示（GET）と更新（PATCH）。一般ユーザー向けの環境で、初回登録を終えた本人だけ。
// ログイン用メールアドレス・パスワードの変更はここでは扱わない。
export const GET = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  const view = await loadProfile(prisma, g.user);
  return view ? json(view) : json({ error: "プロフィールが見つかりません" }, 404);
});

export const PATCH = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  const body = await readJson(request);
  try {
    if (g.user.role === "restaurant") {
      const c = checkRestaurant(body);
      if (!c.ok) return json({ error: "入力内容を確認してください", errors: c.errors }, 400);
      await updateRestaurantProfile(prisma, g.user.id, c.value);
    } else {
      const c = checkProducer(body);
      if (!c.ok) return json({ error: "入力内容を確認してください", errors: c.errors }, 400);
      await updateProducerProfile(prisma, g.user.id, c.value, new Date());
    }
  } catch (e) {
    if (e instanceof OnboardingProblem) return json({ error: e.message, ...(e.field && { errors: { [e.field]: e.message } }) }, e.status);
    throw e;
  }
  return json({ ...(await loadProfile(prisma, g.user)), user: await repo.findSessionUser(g.user.id) });
});
