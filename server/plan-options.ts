import { allocatePlan, type PlanRequest } from "../src/lib/allocate.js";
import { jstDateOf } from "../src/lib/dates.js";
import { prisma } from "./db.js";
import { loadPlanInputs } from "./plan-data.js";

// 受け取り場所をまだ決めていない飲食店のために、希望日（未定なら、これから受け取れる日）に受け取れる各受渡の回（場所＋時間）で、
// 既存の仕入れ案の計算（allocatePlan）をそのまま行い、おすすめ順に並べる。
// ・計算・在庫・日付・締切の判定は既存のロジックのまま（ここでは並べ替えるだけ）。1つの回＝受け取り1か所
// ・並べ方：必要量を確保できる案（MATCHED）を先に → 農家の数が少ない（1農家を最優先）→ 合計が安い → 時間が早い
// ・距離は使わない（座標がないため。市区町村などで距離の代わりにもしない）
// ・案は返すだけで、依頼（ApprovalRequest）・fingerprint・在庫の版の仕組みは使わない。選んだ案は既存の /api/plan で計算し直す

export const MAX_OPTION_SLOTS = 12;

export type PlanOption = {
  slotId: string; label: string; placeName: string; placeKind: string | null;
  startAt: string; endAt: string;
  status: string; requestedKg: number; fulfilledKg: number; shortageKg: number; producerCount: number; totalYen: number | null;
  farms: { producerName: string; kg: number }[];
};

/** 受け取り日を決めていないときに探す範囲（今日から何日先まで） */
export const OPEN_DATE_DAYS = 14;

/**
 * その品目の公開中の出品がある回。希望日があればその日（日本時間）に始まる回、
 * なければ（受け取り日は未定）今からの回のうち、確認の締切が過ぎていないもの（OPEN_DATE_DAYS 日先まで）
 */
async function candidateSlots(itemId: string, desiredDate: string | null, now: Date) {
  const start = desiredDate ? new Date(`${desiredDate}T00:00:00+09:00`) : now;
  const end = new Date(start.getTime() + (desiredDate ? 1 : OPEN_DATE_DAYS) * 24 * 3600e3);
  const slots = await prisma.handoverSlot.findMany({
    where: {
      startAt: { gte: start, lt: end }, supplies: { some: { itemId, published: true, availableKg: { gt: 0 } } },
      ...(!desiredDate && { confirmDeadlineAt: { gt: now } }),
    },
    include: { place: { select: { name: true, kind: true } } }, // 住所は読まない・返さない
    orderBy: [{ startAt: "asc" }, { label: "asc" }],
    take: MAX_OPTION_SLOTS,
  });
  return desiredDate ? slots.filter((s) => jstDateOf(s.startAt) === desiredDate) : slots;
}

export function rankOptions(options: PlanOption[]): PlanOption[] {
  const matched = (o: PlanOption) => (o.status === "MATCHED" ? 0 : 1);
  return [...options].sort((a, b) =>
    matched(a) - matched(b)
    || (matched(a) === 0 ? a.producerCount - b.producerCount : b.fulfilledKg - a.fulfilledKg)
    || (a.totalYen ?? Number.MAX_SAFE_INTEGER) - (b.totalYen ?? Number.MAX_SAFE_INTEGER)
    || a.startAt.localeCompare(b.startAt)
    || a.slotId.localeCompare(b.slotId));
}

/**
 * request の slotId は使わない（回ごとに置き換えて計算する）。
 * desiredDate が null（受け取り日は未定）なら、回ごとにその回の日を希望日として計算する（計算の規則は同じ）
 */
export async function planOptions(request: Omit<PlanRequest, "slotId" | "desiredDate"> & { desiredDate: string | null }, restaurantUserId: string, now: Date): Promise<PlanOption[]> {
  const slots = await candidateSlots(request.itemId, request.desiredDate, now);
  const options = await Promise.all(slots.map(async (s): Promise<PlanOption> => {
    const req: PlanRequest = { ...request, desiredDate: request.desiredDate ?? jstDateOf(s.startAt), slotId: s.id };
    const { inputs } = await loadPlanInputs({ itemId: req.itemId, slotId: s.id, restaurantUserId });
    const plan = allocatePlan({ request: req, ...inputs, now });
    return {
      slotId: s.id, label: s.label, placeName: s.place.name, placeKind: s.place.kind,
      startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(),
      status: plan.status, requestedKg: plan.requestedKg, fulfilledKg: plan.fulfilledKg, shortageKg: plan.shortageKg,
      producerCount: plan.producerCount, totalYen: plan.totalYen,
      farms: plan.allocations.map((a) => ({ producerName: a.producerName, kg: a.kg })),
    };
  }));
  return rankOptions(options);
}
