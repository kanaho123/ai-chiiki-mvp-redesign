import { pendingCount } from "../../src/lib/approvals.js";
import { approvals, approvalHandle } from "../approvals.js";
import { requireOnboardedUser } from "../auth.js";
import { json } from "../http.js";

// 下部ナビの件数（サーバーの実データから数える）。
// ・生産者：まだ返事をしていない相談の数（在庫や条件が変わって使えなくなった相談は数えない）
// ・飲食店：「新しい返事を見たか」を記録していないため、件数は出さない（誤った未確認表示を避ける）
export const GET = approvalHandle(async (request) => {
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  if (g.user.role !== "producer") return json({ producerRequests: 0 });
  return json({ producerRequests: pendingCount(await approvals.list(g.user)) });
});
