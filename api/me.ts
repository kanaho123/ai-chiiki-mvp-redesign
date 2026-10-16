import { currentUser } from "../server/auth.js";
import { isDemoClock, serverNow } from "../server/clock.js";
import { handle, json } from "../server/http.js";

// ログイン中のユーザー（id・role・表示名・生産者情報）。未ログインなら 401。
// demoNow はデモ専用環境（DEMO_NOW 設定時）の基準日時。通常の環境では null
export const GET = handle(async (request) => {
  const demoNow = isDemoClock() ? serverNow().toISOString() : null;
  const user = await currentUser(request);
  return user ? json({ user, demoNow }) : json({ error: "ログインしてください", demoNow }, 401);
});
