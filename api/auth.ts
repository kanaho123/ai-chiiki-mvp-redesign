import { createRouter } from "../server/router.js";
import * as demoAccounts from "../server/routes/auth/demo-accounts.js";
import * as login from "../server/routes/auth/login.js";
import * as logout from "../server/routes/auth/logout.js";
import * as signup from "../server/routes/auth/signup.js";

// ログイン・ログアウト・新規登録・デモ用アカウントの一覧（/api/auth/*）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/auth/login": login,
  "/api/auth/logout": logout,
  "/api/auth/signup": signup,
  "/api/auth/demo-accounts": demoAccounts,
});
