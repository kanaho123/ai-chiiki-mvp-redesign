import { clearSessionCookie } from "../../server/auth.js";
import { handle, json } from "../../server/http.js";

// Cookie を無効化する（署名付き Cookie のため、サーバー側に消すセッションは無い）
export const POST = handle(async () => {
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
});
