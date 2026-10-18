import { createRouter } from "../server/router.js";
import * as one from "../server/routes/approvals/[id].js";
import * as list from "../server/routes/approvals/index.js";

// 生産者への確認依頼（相談）と連絡先（/api/approvals, /api/approvals/:id）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/approvals": list,
  "/api/approvals/:id": one,
});
