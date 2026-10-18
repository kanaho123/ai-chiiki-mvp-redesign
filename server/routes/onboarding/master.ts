import { appMode } from "../../app-mode.js";
import { requireOnboardingUser } from "../../auth.js";
import { prisma } from "../../db.js";
import { handle, json } from "../../http.js";
import { producerOnboardingMaster } from "../../onboarding.js";
import { refillSlotsIfDue } from "../../slot-refill.js";

// 生産者の初回登録で使う選択肢（品目マスタ・運営が有効にしている定期の受渡枠）。
// ログイン済みの生産者だけ（登録前でも使える）。既存の catalog API は登録済みのユーザー専用のまま。
export const GET = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では利用できません" }, 404);
  const g = await requireOnboardingUser(request, "producer");
  if (!g.ok) return g.response;
  await refillSlotsIfDue();
  return json(await producerOnboardingMaster(prisma));
});
