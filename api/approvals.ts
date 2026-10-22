import { createRouter } from "../server/router.js";
import * as one from "../server/routes/approvals/[id].js";
import * as list from "../server/routes/approvals/index.js";
import * as messages from "../server/routes/approvals/messages.js";
import * as received from "../server/routes/approvals/received.js";
import * as review from "../server/routes/approvals/review.js";
import * as usual from "../server/routes/approvals/usual.js";

// 生産者への確認依頼（相談）・連絡先・取引のやり取りと受け取り完了・取引後の評価といつもの農家
// （/api/approvals, /api/approvals/received, /api/approvals/:id, /api/approvals/:id/messages, /api/approvals/:id/review, /api/approvals/:id/usual）を受け持つ Function
export const { GET, POST, PATCH, PUT, DELETE } = createRouter({
  "/api/approvals": list,
  "/api/approvals/received": received, // :id より先に（表の上から順に合うものを使う）
  "/api/approvals/:id": one,
  "/api/approvals/:id/messages": messages,
  "/api/approvals/:id/review": review,
  "/api/approvals/:id/usual": usual,
});
