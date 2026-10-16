// Legacy 限定：旧 Listing（旧仕様の出品）の API。正式な供給の更新は /api/supplies（ログイン・本人確認あり）を使う。
// 編集用合言葉（EDIT_PASSPHRASE）はこの legacy API だけで使う。Phase 5 で旧 Listing と一緒に削除する。
import { parseListingPatch } from "../../src/lib/validate.js";
import { prisma } from "../../server/db.js";
import { requireEditPassphrase } from "../../server/auth.js";
import { handle, json, readJson } from "../../server/http.js";

// 出品の数量変更・公開停止／再開
export const PATCH = handle(async (request) => {
  const denied = requireEditPassphrase(request);
  if (denied) return denied;
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "出品が見つかりません" }, 404);
  const parsed = parseListingPatch(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const exists = await prisma.listing.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return json({ error: "出品が見つかりません" }, 404);
  const listing = await prisma.listing.update({ where: { id }, data: parsed.value });
  return json({ listing });
});
