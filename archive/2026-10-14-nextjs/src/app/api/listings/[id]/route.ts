import { prisma } from "@/lib/db";
import { parseListingPatch } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = parseListingPatch(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const exists = await prisma.listing.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return Response.json({ error: "出品が見つかりません" }, { status: 404 });
  const listing = await prisma.listing.update({ where: { id }, data: parsed.value });
  return Response.json({ listing });
}
