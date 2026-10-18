import { createRouter } from "../server/router.js";
import * as one from "../server/routes/supplies/[id].js";
import * as list from "../server/routes/supplies/index.js";

// 生産者の出品（/api/supplies, /api/supplies/:id）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/supplies": list,
  "/api/supplies/:id": one,
});
