import { PrismaClient } from "@prisma/client";
import { resetDemoData } from "../src/lib/demo";

const prisma = new PrismaClient();

resetDemoData(prisma)
  .then(() => console.log("デモデータを投入しました（A農家5kg・B農家3kg・C農家2kg）"))
  .finally(() => prisma.$disconnect());
