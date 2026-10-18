import { clearSessionCookie, crossSite, crossSiteResponse } from "../../auth.js";
import { handle, json } from "../../http.js";

// Cookie を無効化する（署名付き Cookie のため、サーバー側に消すセッションは無い）
export const POST = handle(async (request) => {
  if (crossSite(request)) return crossSiteResponse(); // 別サイトから勝手にログアウトさせない
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie());
  return res;
});
