import { requireOnboardedUser } from "../../auth.js";
import { approvalHandle, reviews } from "../../approvals.js";
import { json, readJson } from "../../http.js";

// 取引後の評価（/api/approvals/:id/review）。その相談の飲食店と生産者が、受け取り完了後にそれぞれ1回。
// 読めるのは自分の評価だけ（相手の評価は返さない）
const idOf = (request: Request) => new URL(request.url).pathname.split("/").at(-2) ?? "";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const GET = approvalHandle(async (request) => {
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  const id = idOf(request);
  if (!ID.test(id)) return json({ error: "相談の指定が不正です" }, 400);
  return json(await reviews.get(g.user, id));
});

export const POST = approvalHandle(async (request) => {
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  const id = idOf(request);
  if (!ID.test(id)) return json({ error: "相談の指定が不正です" }, 400);
  return json({ review: await reviews.create(g.user, id, await readJson(request)) }, 201);
});
