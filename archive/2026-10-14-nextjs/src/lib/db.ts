import { PrismaClient } from "@prisma/client";
import type { SupplyListing } from "./allocate";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function loadListings(): Promise<SupplyListing[]> {
  const rows = await prisma.listing.findMany({ include: { producer: true }, orderBy: { createdAt: "asc" } });
  return rows.map(({ producer, createdAt, updatedAt, producerId, ...l }) => ({ ...l, producerName: producer.name }));
}

/**
 * 出品の状態を表す値。出品の追加・数量変更・公開停止で変わる。
 * 表示中の仕入れ案がこの値と違えば、その案は古い。
 */
export async function inventoryVersion(): Promise<string> {
  const agg = await prisma.listing.aggregate({ _count: true, _max: { updatedAt: true } });
  return `${agg._count}:${agg._max.updatedAt?.getTime() ?? 0}`;
}
