import { requireRole, requireOnboardedUser } from "../../auth.js";
import { approvals, approvalHandle, parseContact } from "../../approvals.js";
import { json, readJson } from "../../http.js";
import { prisma } from "../../db.js";

export const GET = approvalHandle(async request => {
  if (new URL(request.url).searchParams.get("view") === "contact") {
    const g = await requireRole(request, "producer");
    if (!g.ok) return g.response;
    if (!g.user.producer) return json({ error: "生産者情報がありません" }, 404);
    const contact = await prisma.producer.findFirst({ where: { id: g.user.producer.id, ownerUserId: g.user.id }, select: { contactPhone: true, contactEmail: true } });
    return contact ? json({ contact }) : json({ error: "生産者情報がありません" }, 404);
  }
  const g = await requireOnboardedUser(request);
  if (!g.ok) return g.response;
  const fingerprint = new URL(request.url).searchParams.get("fingerprint") ?? undefined;
  return json({ requests: await approvals.list(g.user, fingerprint) });
});
export const PATCH = approvalHandle(async request => {
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  if (!g.user.producer) return json({ error: "生産者情報がありません" }, 404);
  const data = parseContact(await readJson(request));
  const updated = await prisma.producer.updateMany({ where: { id: g.user.producer.id, ownerUserId: g.user.id }, data });
  return updated.count === 1 ? json({ contact: data }) : json({ error: "生産者情報がありません" }, 404);
});
export const POST = approvalHandle(async request => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  return json({ requests: await approvals.create(g.user, await readJson(request)) });
});
