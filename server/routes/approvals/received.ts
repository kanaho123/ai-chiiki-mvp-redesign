import { requireRole } from "../../auth.js";
import { approvalHandle, trades } from "../../approvals.js";
import { json, readJson } from "../../http.js";

// 受け取り完了（/api/approvals/received）。飲食店が仕入れ案ごとに1回。同じ仕入れ案の「対応できます」の行すべてを完了にする
export const POST = approvalHandle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const body = (await readJson(request)) as { fingerprint?: unknown } | null;
  return json({ requests: await trades.received(g.user, body?.fingerprint) });
});
