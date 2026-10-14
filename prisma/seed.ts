import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../server/db.js");
const { seedDemoData } = await import("../server/demo.js");

try {
  const { availableDate } = await seedDemoData(prisma);
  console.log(`デモデータを投入しました（A農家5kg・B農家3kg・C農家2kg、受渡日 ${availableDate}）`);
} finally {
  await prisma.$disconnect();
}
