import { requireRole } from "../../server/auth.js";
import { approvals, approvalHandle } from "../../server/approvals.js";
import { json, readJson } from "../../server/http.js";

export const GET = approvalHandle(async request => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const id = new URL(request.url).pathname.split("/").at(-1) ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "依頼の指定が不正です" }, 400);
  return json({ contact: await approvals.contact(g.user, id) });
});

export const PATCH = approvalHandle(async request => {
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  const id = new URL(request.url).pathname.split("/").at(-1) ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "依頼の指定が不正です" }, 400);
  const body = await readJson(request) as { status?: unknown } | null;
  return json({ request: await approvals.respond(g.user, id, body?.status) });
});
