import { parseLogin } from "../../src/lib/validate.js";
import { createSessionToken, sessionCookie, verifyPassword } from "../../server/auth.js";
import { handle, json, readJson } from "../../server/http.js";
import { repo } from "../../server/repo.js";

const FAILED = "ログイン情報を確認してください";

// ログイン名＋パスワードでログインし、署名付きの HttpOnly Cookie を発行する。
// 失敗理由（ユーザーが無い・パスワード違い）は区別せず、内部情報も返さない。
export const POST = handle(async (request) => {
  const parsed = parseLogin(await readJson(request));
  if (!parsed.ok) return json({ error: FAILED }, 401);
  const found = await repo.findLoginUser(parsed.value.loginId);
  const ok = await verifyPassword(parsed.value.password, found?.passwordHash ?? null);
  const user = ok && found ? await repo.findSessionUser(found.id) : null;
  if (!user) return json({ error: FAILED }, 401);

  const res = json({ user });
  res.headers.append("Set-Cookie", sessionCookie(createSessionToken(user, new Date())));
  return res;
});
