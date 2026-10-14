import { createPlan } from "@/lib/allocate";
import { jstDate } from "@/lib/dates";
import { inventoryVersion, loadListings } from "@/lib/db";
import { parsePlanRequest } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = parsePlanRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  // 計算に使った出品と同じ状態の version を返す
  const [listings, version] = await Promise.all([loadListings(), inventoryVersion()]);
  const plan = createPlan(parsed.value, listings, jstDate());
  return Response.json({ plan, version, request: parsed.value });
}
