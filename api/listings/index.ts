// Legacy 限定：旧 Listing（旧仕様の出品）の API。正式な供給の更新は /api/supplies（ログイン・本人確認あり）を使う。
// 編集用合言葉（EDIT_PASSPHRASE）はこの legacy API だけで使う。Phase 5 で旧 Listing と一緒に削除する。
import { parseListingInput } from "../../src/lib/validate.js";
import { loadListings, prisma } from "../../server/db.js";
import { requireEditPassphrase } from "../../server/auth.js";
import { handle, json, readJson } from "../../server/http.js";

export const GET = handle(async () => {
  const [listings, producers] = await Promise.all([
    loadListings(),
    prisma.legacyProducer.findMany({ orderBy: { name: "asc" } }),
  ]);
  return json({ listings, producers });
});

export const POST = handle(async (request) => {
  const denied = requireEditPassphrase(request);
  if (denied) return denied;
  const parsed = parseListingInput(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { producer, ...data } = parsed.value;

  if ("id" in producer && !(await prisma.legacyProducer.findUnique({ where: { id: producer.id }, select: { id: true } })))
    return json({ error: "生産者が見つかりません。選び直してください" }, 400);

  const listing = await prisma.listing.create({
    data: {
      ...data,
      producer: "id" in producer ? { connect: { id: producer.id } } : { create: { name: producer.name } },
    },
  });
  return json({ listing }, 201);
});
