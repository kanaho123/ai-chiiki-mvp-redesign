import { parseListingPatch } from "../../src/lib/validate.js";
import { prisma } from "../../server/db.js";
import { handle, json, readJson } from "../../server/http.js";

// 出品の数量変更・公開停止／再開
export const PATCH = handle(async (request) => {
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "出品が見つかりません" }, 404);
  const parsed = parseListingPatch(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const exists = await prisma.listing.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return json({ error: "出品が見つかりません" }, 404);
  const listing = await prisma.listing.update({ where: { id }, data: parsed.value });
  return json({ listing });
});
