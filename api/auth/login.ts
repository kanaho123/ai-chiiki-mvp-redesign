import { parseLogin } from "../../src/lib/validate.js";
import { createSessionToken, sessionCookie, verifyPassword } from "../../server/auth.js";
import { handle, json, readJson } from "../../server/http.js";
import { clientIp, FailureLimiter } from "../../server/rate-limit.js";
import { repo } from "../../server/repo.js";

const FAILED = "ログイン情報を確認してください";
const LOCKED = "ログインの失敗が続いたため、しばらく時間をおいてからお試しください";

// 同じログイン名＋接続元で 15 分以内に 5 回失敗したら、そのログイン名は 15 分間受け付けない。
// 接続元だけの制限は緩く（30 回）し、会場の共有回線で他の利用者まで締め出さないようにする
export const loginLimiter = new FailureLimiter(5, 15 * 60_000, 15 * 60_000);
export const ipLimiter = new FailureLimiter(30, 15 * 60_000, 15 * 60_000);

// ログイン名＋パスワードでログインし、署名付きの HttpOnly Cookie を発行する。
// 失敗理由（ユーザーが無い・パスワード違い）は区別せず、内部情報も返さない。
export const POST = handle(async (request) => {
  const parsed = parseLogin(await readJson(request));
  if (!parsed.ok) return json({ error: FAILED }, 401);
  const ip = clientIp(request);
  const key = `${parsed.value.loginId}|${ip}`;
  if (loginLimiter.isLocked(key) || ipLimiter.isLocked(ip)) return json({ error: LOCKED }, 429);

  const found = await repo.findLoginUser(parsed.value.loginId);
  const ok = await verifyPassword(parsed.value.password, found?.passwordHash ?? null);
  const user = ok && found ? await repo.findSessionUser(found.id) : null;
  if (!user) {
    loginLimiter.fail(key);
    ipLimiter.fail(ip);
    return json({ error: FAILED }, 401);
  }
  loginLimiter.reset(key);

  const res = json({ user });
  res.headers.append("Set-Cookie", sessionCookie(createSessionToken(user, new Date())));
  return res;
});
