import { currentUser } from "../server/auth.js";
import { handle, json } from "../server/http.js";

// ログイン中のユーザー（id・role・表示名・生産者情報）。未ログインなら 401
export const GET = handle(async (request) => {
  const user = await currentUser(request);
  return user ? json({ user }) : json({ error: "ログインしてください" }, 401);
});
