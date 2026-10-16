import { PrismaClient } from "./generated/prisma/client.js";
import type { SupplyListing } from "../src/lib/legacy-listing.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
globalForPrisma.prisma = prisma;

/** Legacy: 旧出品（生産者画面・ホームの旧表示用）。Phase 3 で Supply に移行後に削除する */
export async function loadListings(): Promise<SupplyListing[]> {
  const rows = await prisma.listing.findMany({ include: { producer: true }, orderBy: { createdAt: "asc" } });
  return rows.map(({ producer, createdAt, updatedAt, ...l }) => ({ ...l, producerName: producer.name }));
}
