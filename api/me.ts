import { appMode } from "../server/app-mode.js";
import { currentUser } from "../server/auth.js";
import { isDemoClock, serverNow } from "../server/clock.js";
import { handle, json } from "../server/http.js";

// ログイン中のユーザー（id・role・表示名・生産者情報）。未ログインなら 401。
// demoNow はデモ専用環境（DEMO_NOW 設定時）の基準日時。通常の環境では null
// appMode は表示の切り替え用（読み取りのみ。クライアントから変更はできない）
export const GET = handle(async (request) => {
  const demoNow = isDemoClock() ? serverNow().toISOString() : null;
  const mode = appMode();
  const user = await currentUser(request);
  return user ? json({ user, demoNow, appMode: mode }) : json({ error: "ログインしてください", demoNow, appMode: mode }, 401);
});
