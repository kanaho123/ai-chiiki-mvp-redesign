import { prisma } from "@/lib/db";
import { resetDemoData } from "@/lib/demo";

export const dynamic = "force-dynamic";

// 本番では DEMO_RESET_ENABLED=true のときだけ使える
const enabled = () => process.env.NODE_ENV !== "production" || process.env.DEMO_RESET_ENABLED === "true";

export async function POST() {
  if (!enabled()) return Response.json({ error: "この操作は無効です" }, { status: 403 });
  await resetDemoData(prisma);
  return Response.json({ ok: true });
}
