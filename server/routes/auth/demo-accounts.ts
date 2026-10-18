import { isDemoMode } from "../../app-mode.js";
import { isDemoClock } from "../../clock.js";
import { prisma } from "../../db.js";
import { handle, json } from "../../http.js";

// デモ環境（APP_MODE=demo かつ DEMO_NOW 設定時）だけ、ログイン名の候補を返す。パスワードは返さない。
export const GET = handle(async () => {
  if (!isDemoMode() || !isDemoClock()) return json({ accounts: [] });
  const users = await prisma.user.findMany({
    where: { loginId: { startsWith: "demo-" }, passwordHash: { not: null } },
    select: { loginId: true, displayName: true, role: true },
    orderBy: [{ role: "asc" }, { loginId: "asc" }], // 飲食店 → 農園の順
  });
  return json({ accounts: users });
});
