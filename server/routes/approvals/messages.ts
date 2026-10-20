import { requireOnboardedUser } from "../../auth.js";
import { approvalHandle, trades } from "../../approvals.js";
import { json, readJson } from "../../http.js";

// 取引のやり取り（/api/approvals/:id/messages）。読み書きできるのは、その相談の飲食店と生産者だけ。取引の成立後だけ使える
const idOf = (request: Request) => new URL(request.url).pathname.split("/").at(-2) ?? "";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const GET = approvalHandle(async (request) => {
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  const id = idOf(request);
  if (!ID.test(id)) return json({ error: "相談の指定が不正です" }, 400);
  return json(await trades.messages(g.user, id));
});

export const POST = approvalHandle(async (request) => {
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  const id = idOf(request);
  if (!ID.test(id)) return json({ error: "相談の指定が不正です" }, 400);
  const body = (await readJson(request)) as { body?: unknown } | null;
  return json({ message: await trades.send(g.user, id, body?.body) }, 201);
});
