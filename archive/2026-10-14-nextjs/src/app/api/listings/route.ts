import { loadListings, prisma } from "@/lib/db";
import { parseListingInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ listings: await loadListings() });
}

export async function POST(req: Request) {
  const parsed = parseListingInput(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { producerName, ...data } = parsed.value;
  const listing = await prisma.listing.create({
    data: {
      ...data,
      producer: { connectOrCreate: { where: { name: producerName }, create: { name: producerName } } },
    },
  });
  return Response.json({ listing }, { status: 201 });
}
