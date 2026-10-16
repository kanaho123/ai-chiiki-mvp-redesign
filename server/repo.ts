import { prisma } from "./db.js";

// 認証・供給 API が使う DB アクセスをここに集める（権限テストではこのモジュールを差し替える）。

export type Role = "restaurant" | "producer";

/** セッションで扱うユーザー情報（パスワードハッシュは含めない） */
export type SessionUser = {
  id: string;
  role: Role;
  displayName: string;
  producer: { id: string; farmName: string; originPrefecture: string } | null;
};

export type SupplyView = {
  id: string;
  producerId: string;
  item: { id: string; name: string };
  variety: { id: string; name: string };
  grade: "regular" | "irregular";
  irregularReason: string | null;
  originPrefecture: string;
  availableKg: number;
  priceYenPerKg: number;
  minKg: number;
  slot: { id: string; label: string; placeName: string; startAt: string; endAt: string };
  published: boolean;
  version: number;
  updatedAt: string;
};

export type SupplyCreate = {
  producerId: string;
  itemId: string;
  varietyId: string;
  grade: "regular" | "irregular";
  irregularReason: string | null;
  originPrefecture: string;
  availableKg: number;
  priceYenPerKg: number;
  minKg: number;
  slotId: string;
  published: boolean;
};

const supplyInclude = { item: true, variety: true, slot: { include: { place: true } } } as const;

type SupplyRow = Awaited<ReturnType<typeof findSupplyRow>>;
const findSupplyRow = (id: string) => prisma.supply.findUnique({ where: { id }, include: supplyInclude });

function toView(s: NonNullable<SupplyRow>): SupplyView {
  return {
    id: s.id, producerId: s.producerId, item: { id: s.item.id, name: s.item.name }, variety: { id: s.variety.id, name: s.variety.name },
    grade: s.grade, irregularReason: s.irregularReason, originPrefecture: s.originPrefecture, availableKg: s.availableKg,
    priceYenPerKg: s.priceYenPerKg, minKg: s.minKg,
    slot: { id: s.slot.id, label: s.slot.label, placeName: s.slot.place.name, startAt: s.slot.startAt.toISOString(), endAt: s.slot.endAt.toISOString() },
    published: s.published, version: s.version, updatedAt: s.updatedAt.toISOString(),
  };
}

export const repo = {
  async findLoginUser(loginId: string): Promise<{ id: string; passwordHash: string | null } | null> {
    return prisma.user.findUnique({ where: { loginId }, select: { id: true, passwordHash: true } });
  },

  async findSessionUser(id: string): Promise<SessionUser | null> {
    const u = await prisma.user.findUnique({ where: { id }, include: { producers: { orderBy: { id: "asc" }, take: 1 } } });
    if (!u) return null;
    const p = u.producers[0];
    return { id: u.id, role: u.role, displayName: u.displayName, producer: p ? { id: p.id, farmName: p.farmName, originPrefecture: p.originPrefecture } : null };
  },

  async listOwnSupplies(producerId: string): Promise<SupplyView[]> {
    const rows = await prisma.supply.findMany({ where: { producerId }, include: supplyInclude, orderBy: [{ slot: { startAt: "asc" } }, { id: "asc" }] });
    return rows.map(toView);
  },

  async findSupplyOwner(id: string): Promise<{ id: string; producerId: string } | null> {
    return prisma.supply.findUnique({ where: { id }, select: { id: true, producerId: true } });
  },

  async getSupply(id: string): Promise<SupplyView | null> {
    const s = await findSupplyRow(id);
    return s ? toView(s) : null;
  },

  /** version が一致したときだけ更新し、version を +1 する。一致しなければ null（競合） */
  async updateSupplyIfVersion(id: string, version: number, data: { availableKg?: number; published?: boolean }): Promise<SupplyView | null> {
    const { count } = await prisma.supply.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    return count === 1 ? this.getSupply(id) : null;
  },

  /** 生産者が参加登録している受渡枠（供給の登録先として選べる枠） */
  async producerSlots(producerId: string) {
    const rows = await prisma.slotParticipant.findMany({ where: { producerId }, include: { slot: { include: { place: true } } }, orderBy: { slot: { startAt: "asc" } } });
    return rows.map((r) => ({
      id: r.slot.id, label: r.slot.label, placeName: r.slot.place.name, startAt: r.slot.startAt.toISOString(), endAt: r.slot.endAt.toISOString(),
      participationConfirmed: r.confirmed,
    }));
  },

  async itemsWithVarieties() {
    const items = await prisma.item.findMany({ include: { varieties: { orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
    return items.map((i) => ({ id: i.id, name: i.name, varieties: i.varieties.map((v) => ({ id: v.id, name: v.name })) }));
  },

  /** 新しい供給を作る。同じ農家・品目・枠の供給がすでにあれば null */
  async createSupply(data: SupplyCreate): Promise<SupplyView | null> {
    const dup = await prisma.supply.findFirst({ where: { producerId: data.producerId, itemId: data.itemId, slotId: data.slotId }, select: { id: true } });
    if (dup) return null;
    const s = await prisma.supply.create({ data, include: supplyInclude });
    return toView(s);
  },
};
