import { formatDateJa } from "./dates";

export type SupplyListing = {
  id: string;
  producerName: string;
  item: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  availableDate: string;
  region: string;
  irregularReason: string | null;
  handoverPlace: string;
  handoverStart: string;
  handoverEnd: string;
  minQuantity: number;
  step: number;
  handoverFee: number;
  isPublic: boolean;
};

export type PlanRequest = {
  item: string;
  quantity: number;
  unit: string;
  deadline: string; // この日までに受け取りたい（日本時間 YYYY-MM-DD）
  region: string;
  allowIrregular: boolean;
  maxUnitPrice: number | null; // 税込単価の上限（円/単位）
  handoverPlace: string | null;
  handoverFrom: string | null; // 受け取れる時間帯（HH:MM）
  handoverTo: string | null;
};

export type Allocation = {
  listingId: string;
  producerName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  handoverFee: number;
  irregularReason: string | null;
};

export type Handover = { date: string; place: string; start: string; end: string };

export type PlanStatus = "fulfilled" | "shortage" | "handover_mismatch" | "none";

export type PlanResult = {
  status: PlanStatus;
  message: string;
  requested: number;
  unit: string;
  totalQuantity: number;
  shortage: number;
  subtotal: number; // 商品代（税込）
  handoverFee: number;
  total: number;
  handover: Handover | null;
  allocations: Allocation[];
  excluded: { listingId: string; producerName: string; quantity: number; unit: string; reasons: string[] }[];
  notices: string[];
};

/** 1つのグループ内で探索する出品数の上限（安い順に採用） */
const MAX_LISTINGS_PER_GROUP = 12;

/** 在庫上限・最低販売量・販売刻みを守って配分できる数量（limit 以下） */
export function allowedQuantities(l: Pick<SupplyListing, "quantity" | "minQuantity" | "step">, limit: number): number[] {
  const out: number[] = [];
  if (l.step < 1 || l.minQuantity < 1) return out;
  for (let q = l.minQuantity; q <= Math.min(l.quantity, limit); q += l.step) out.push(q);
  return out;
}

function exclusionReasons(l: SupplyListing, req: PlanRequest, today: string): string[] {
  const r: string[] = [];
  if (!l.isPublic) r.push("公開停止中");
  if (l.unit !== req.unit) r.push(`単位が異なる（${l.unit}）`);
  if (l.availableDate < today) r.push("受渡日を過ぎている");
  else if (l.availableDate > req.deadline) r.push(`受渡日が希望日より後（${formatDateJa(l.availableDate)}）`);
  if (l.region !== req.region) r.push(`地域が異なる（${l.region}）`);
  if (l.irregularReason && !req.allowIrregular) r.push(`規格外（${l.irregularReason}）のため対象外`);
  if (req.maxUnitPrice !== null && l.unitPrice > req.maxUnitPrice)
    r.push(`単価が上限を超える（${l.unitPrice}円/${l.unit}）`);
  if (req.handoverPlace !== null && l.handoverPlace !== req.handoverPlace)
    r.push(`受渡場所が異なる（${l.handoverPlace}）`);
  if (req.handoverFrom !== null && l.handoverStart < req.handoverFrom)
    r.push(`受渡時間が指定外（${l.handoverStart}〜${l.handoverEnd}）`);
  else if (req.handoverTo !== null && l.handoverEnd > req.handoverTo)
    r.push(`受渡時間が指定外（${l.handoverStart}〜${l.handoverEnd}）`);
  if (r.length === 0) {
    if (l.quantity < l.minQuantity) r.push(`在庫が最低販売量（${l.minQuantity}${l.unit}）に満たない`);
    else if (allowedQuantities(l, req.quantity).length === 0)
      r.push(`最低販売量（${l.minQuantity}${l.unit}）が希望数量を超える`);
  }
  return r;
}

type Best = { total: number; count: number; cost: number; picks: { listing: SupplyListing; quantity: number }[] };

/**
 * 同じ受渡条件のグループ内で、希望数量以下で最大の数量を、
 * 仕入れ先が少ない → 合計価格が低い の順で選ぶ。
 */
function bestInGroup(listings: SupplyListing[], demand: number): Best | null {
  const ls = [...listings].sort((a, b) => a.unitPrice - b.unitPrice).slice(0, MAX_LISTINGS_PER_GROUP);
  type Cell = { count: number; cost: number } | null;
  // layers[i][t]: 先頭 i 件までで合計 t の最良値、choice[i][t]: i 件目に割り当てた数量
  const layers: Cell[][] = [Array.from({ length: demand + 1 }, (_, t) => (t === 0 ? { count: 0, cost: 0 } : null))];
  const choice: number[][] = [];

  ls.forEach((l, i) => {
    const prev = layers[i];
    const next: Cell[] = prev.map((c) => c && { ...c });
    const pick = new Array<number>(demand + 1).fill(0);
    const qs = allowedQuantities(l, demand);
    for (let t = 0; t <= demand; t++) {
      const c = prev[t];
      if (!c) continue;
      for (const q of qs) {
        const nt = t + q;
        if (nt > demand) break;
        const cand = { count: c.count + 1, cost: c.cost + q * l.unitPrice + l.handoverFee };
        const cur = next[nt];
        if (!cur || cand.count < cur.count || (cand.count === cur.count && cand.cost < cur.cost)) {
          next[nt] = cand;
          pick[nt] = q;
        }
      }
    }
    layers.push(next);
    choice.push(pick);
  });

  const last = layers[ls.length];
  let total = demand;
  while (total > 0 && !last[total]) total--;
  if (total === 0) return null;

  const picks: Best["picks"] = [];
  let t = total;
  for (let i = ls.length - 1; i >= 0; i--) {
    const q = choice[i][t];
    if (q > 0) {
      picks.unshift({ listing: ls[i], quantity: q });
      t -= q;
    }
  }
  return { total, count: last[total]!.count, cost: last[total]!.cost, picks };
}

function isBetter(a: Best, b: Best): boolean {
  if (a.total !== b.total) return a.total > b.total;
  if (a.count !== b.count) return a.count < b.count;
  return a.cost < b.cost;
}

export function createPlan(req: PlanRequest, listings: SupplyListing[], today: string): PlanResult {
  const sameItem = listings.filter((l) => l.item === req.item);
  const excluded: PlanResult["excluded"] = [];
  const eligible: SupplyListing[] = [];
  for (const l of sameItem) {
    const reasons = exclusionReasons(l, req, today);
    if (reasons.length) excluded.push({ listingId: l.id, producerName: l.producerName, quantity: l.quantity, unit: l.unit, reasons });
    else eligible.push(l);
  }

  const notices: string[] = [];
  if (sameItem.some((l) => l.isPublic && l.unit !== req.unit))
    notices.push("数量単位が異なるため組み合わせられない在庫があります（単位は換算しません）");

  // 受渡日・場所・時間が同じ出品だけを組み合わせる
  const groups = new Map<string, SupplyListing[]>();
  for (const l of eligible) {
    const key = [l.availableDate, l.handoverPlace, l.handoverStart, l.handoverEnd].join("|");
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  let best: Best | null = null;
  for (const g of groups.values()) {
    const b = bestInGroup(g, req.quantity);
    if (b && (!best || isBetter(b, best))) best = b;
  }

  const base = { requested: req.quantity, unit: req.unit, excluded, notices };
  const u = req.unit;

  if (!best) {
    return {
      ...base,
      status: "none",
      message: `希望${req.quantity}${u}に対し、条件の合う登録数量は0${u}。${req.quantity}${u}不足`,
      totalQuantity: 0,
      shortage: req.quantity,
      subtotal: 0,
      handoverFee: 0,
      total: 0,
      handover: null,
      allocations: [],
    };
  }

  const allocations: Allocation[] = best.picks.map(({ listing: l, quantity }) => ({
    listingId: l.id,
    producerName: l.producerName,
    quantity,
    unitPrice: l.unitPrice,
    subtotal: quantity * l.unitPrice,
    handoverFee: l.handoverFee,
    irregularReason: l.irregularReason,
  }));
  const first = best.picks[0].listing;
  const subtotal = allocations.reduce((s, a) => s + a.subtotal, 0);
  const handoverFee = allocations.reduce((s, a) => s + a.handoverFee, 0);
  const shortage = req.quantity - best.total;

  // 受渡条件をそろえなければ数量が足りる場合
  const usableAcrossGroups = eligible.reduce((s, l) => s + Math.max(0, ...allowedQuantities(l, req.quantity)), 0);
  let status: PlanStatus = "fulfilled";
  let message = `条件を満たす${req.quantity}${u}の仕入れ案が見つかりました`;
  if (shortage > 0) {
    if (groups.size > 1 && usableAcrossGroups >= req.quantity) {
      status = "handover_mismatch";
      message = `数量はありますが、同じ日時・場所で受け取れる組み合わせがありません（同じ受渡条件では最大${best.total}${u}）`;
    } else {
      status = "shortage";
      message = `希望${req.quantity}${u}に対し、条件の合う登録数量は${best.total}${u}。${shortage}${u}不足`;
    }
  }

  return {
    ...base,
    status,
    message,
    totalQuantity: best.total,
    shortage,
    subtotal,
    handoverFee,
    total: subtotal + handoverFee,
    handover: { date: first.availableDate, place: first.handoverPlace, start: first.handoverStart, end: first.handoverEnd },
    allocations,
  };
}
