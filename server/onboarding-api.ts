import type { Checked, ProducerProfile, RestaurantProfile } from "../src/lib/onboarding.js";
import { appMode } from "./app-mode.js";
import { requireOnboardingUser } from "./auth.js";
import { prisma } from "./db.js";
import { json, readJson } from "./http.js";
import { completeProducerOnboarding, completeRestaurantOnboarding, OnboardingProblem } from "./onboarding.js";
import { repo } from "./repo.js";
import { refillSlotsIfDue } from "./slot-refill.js";

// 初回登録の完了 API の共通処理（飲食店・生産者）。
// ・一般ユーザー向けの環境だけ（デモ用アカウントは最初から登録済み）
// ・ログイン済みで、送信先と同じロールのユーザーだけ（登録前でも通す専用の確認）
// ・入力はサーバーで必ず確認し、誤りは欄ごとに返す
type Profiles = { restaurant: RestaurantProfile; producer: ProducerProfile };

export async function completeOnboarding<R extends keyof Profiles>(request: Request, role: R, check: (body: unknown) => Checked<string, Profiles[R]>) {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireOnboardingUser(request, role);
  if (!g.ok) return g.response;
  const checked = check(await readJson(request));
  if (!checked.ok) return json({ error: "入力内容を確認してください", errors: checked.errors }, 400);
  if (role === "producer") await refillSlotsIfDue(); // 参加する受渡枠の、これからの回をそろえてから登録する
  try {
    const now = new Date();
    const result = role === "restaurant"
      ? await completeRestaurantOnboarding(prisma, g.user.id, checked.value as RestaurantProfile, now)
      : await completeProducerOnboarding(prisma, g.user.id, checked.value as ProducerProfile, now);
    return json({ status: result.status, user: await repo.findSessionUser(g.user.id) });
  } catch (e) {
    if (e instanceof OnboardingProblem) return json({ error: e.message, ...(e.field && { errors: { [e.field]: e.message } }) }, e.status);
    throw e;
  }
}
