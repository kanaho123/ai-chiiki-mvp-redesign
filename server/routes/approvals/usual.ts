import { requireRole } from "../../auth.js";
import { approvalHandle, reviews } from "../../approvals.js";
import { json } from "../../http.js";

// 「いつもの農家」に登録（/api/approvals/:id/usual）。飲食店だけ。受け取りまで完了した取引の農家だけ登録できる
const idOf = (request: Request) => new URL(request.url).pathname.split("/").at(-2) ?? "";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const POST = approvalHandle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const id = idOf(request);
  if (!ID.test(id)) return json({ error: "相談の指定が不正です" }, 400);
  return json(await reviews.markUsual(g.user, id));
});
