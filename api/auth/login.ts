import { parseLogin } from "../../src/lib/validate.js";
import { normalizeEmail } from "../../server/accounts.js";
import { appMode } from "../../server/app-mode.js";
import { createSessionToken, sessionCookie, verifyPassword } from "../../server/auth.js";
import { handle, json, readJson } from "../../server/http.js";
import { clientIp } from "../../server/rate-limit.js";
import { repo } from "../../server/repo.js";

const FAILED = "ログイン情報を確認してください";
const LOCKED = "ログインの失敗が続いたため、しばらく時間をおいてからお試しください";

// 総当たり対策。失敗回数は DB に記録する（サーバーレスでもインスタンス間で共有される）。
// ・同じログイン名＋接続元：15分以内に5回失敗で15分ロック
// ・同じ接続元：15分以内に30回失敗で15分ロック（ログイン名を変えた総当たりを止める）
// ログイン名だけでロックはしない（第三者がデモ用アカウントを締め出せないようにするため）
const WINDOW_MS = 15 * 60_000;
export const LOGIN_RULES = {
  account: { max: 5, windowMs: WINDOW_MS, lockMs: WINDOW_MS },
  ip: { max: 30, windowMs: WINDOW_MS, lockMs: WINDOW_MS },
};

type Credentials = { kind: "email" | "loginId"; id: string; password: string };

/** 一般ユーザー向け（general）はメールアドレスだけ。デモ（demo）はデモ用ログイン名（demo-r 等）とメールアドレスの両方 */
function readCredentials(body: unknown): Credentials | null {
  if (body && typeof body === "object" && typeof (body as Record<string, unknown>).email === "string") {
    const b = body as Record<string, unknown>;
    const email = normalizeEmail(b.email as string);
    const password = typeof b.password === "string" ? b.password : "";
    if (!email || email.length > 254 || password.length < 1 || password.length > 200) return null;
    return { kind: "email", id: email, password };
  }
  if (appMode() === "general") return null;
  const parsed = parseLogin(body);
  return parsed.ok ? { kind: "loginId", id: parsed.value.loginId, password: parsed.value.password } : null;
}

// メールアドレス（またはデモ用ログイン名）＋パスワードでログインし、署名付きの HttpOnly Cookie を発行する。
// 失敗理由（ユーザーが無い・パスワード違い）は区別せず、内部情報も返さない。
export const POST = handle(async (request) => {
  const cred = readCredentials(await readJson(request));
  if (!cred) return json({ error: FAILED }, 401);
  const now = new Date();
  const ip = clientIp(request);
  const accountKey = `${cred.kind === "email" ? "email:" : ""}${cred.id}|${ip}`;
  const ipKey = `ip:${ip}`;
  if (await repo.isThrottled([accountKey, ipKey], now)) return json({ error: LOCKED }, 429);

  const found = cred.kind === "email" ? await repo.findLoginUserByEmail(cred.id) : await repo.findLoginUser(cred.id);
  const ok = await verifyPassword(cred.password, found?.passwordHash ?? null);
  const user = ok && found ? await repo.findSessionUser(found.id) : null;
  if (!user) {
    await repo.recordLoginFailure(accountKey, now, LOGIN_RULES.account);
    await repo.recordLoginFailure(ipKey, now, LOGIN_RULES.ip);
    return json({ error: FAILED }, 401);
  }
  await repo.clearLoginFailures(accountKey);

  const res = json({ user });
  res.headers.append("Set-Cookie", sessionCookie(createSessionToken(user, now)));
  return res;
});
