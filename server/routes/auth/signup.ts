import { createAccount, parseSignup } from "../../accounts.js";
import { appMode } from "../../app-mode.js";
import { createSessionToken, crossSite, crossSiteResponse, sessionCookie } from "../../auth.js";
import { handle, json, readJson } from "../../http.js";
import { clientIp } from "../../rate-limit.js";
import { repo } from "../../repo.js";

// 一般ユーザーの新規登録（一般ユーザー向けの環境 APP_MODE=general だけ）。登録後はそのままログイン状態にする。
// ・メールアドレスはサーバーで trim＋小文字化してから重複判定・保存する
// ・利用規約／プライバシーポリシーの版と同意日時はサーバーで記録する（クライアントの値は使わない）
// ・同じ接続元からの登録は1時間に10回まで（成功・失敗を問わず数える。大量作成を止める）
export const SIGNUP_RULE = { max: 10, windowMs: 60 * 60_000, lockMs: 60 * 60_000 };

export const POST = handle(async (request) => {
  if (appMode() !== "general") return json({ error: "この環境では新規登録できません" }, 404);
  if (crossSite(request)) return crossSiteResponse();
  const now = new Date();
  const ipKey = `signup-ip:${clientIp(request)}`;
  if (await repo.isThrottled([ipKey], now)) return json({ error: "登録の操作が続いたため、しばらく時間をおいてからお試しください" }, 429);
  await repo.recordLoginFailure(ipKey, now, SIGNUP_RULE);

  const parsed = parseSignup(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error, field: parsed.field }, 400);

  const created = await createAccount(parsed.value, now, repo);
  if (!created.ok && created.reason === "duplicate-email") {
    return json({ error: "このメールアドレスはすでに登録されています。ログインしてください", field: "email" }, 409);
  }
  if (!created.ok) return json({ error: "登録できませんでした。時間をおいてもう一度お試しください" }, 500);

  const user = await repo.findSessionUser(created.id);
  if (!user) return json({ error: "登録できませんでした。時間をおいてもう一度お試しください" }, 500);
  const res = json({ user }, 201);
  res.headers.append("Set-Cookie", sessionCookie(createSessionToken(user, now)));
  return res;
});
