import { createRouter } from "../server/router.js";
import * as inbox from "../server/routes/inbox.js";
import * as me from "../server/routes/me.js";
import * as profile from "../server/routes/profile.js";

// ログイン中の本人（/api/me）・下部ナビの件数（/api/inbox）・マイページ（/api/profile）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/me": me,
  "/api/inbox": inbox,
  "/api/profile": profile,
});
