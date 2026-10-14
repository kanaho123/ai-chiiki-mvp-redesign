// 仕入れ案 API の動作確認（vercel dev 起動中に実行）。
// 使い方: npx tsx scripts/api-smoke.ts [http://localhost:3000]
// デモデータを初期化して確認し、最後にもう一度初期化して元に戻す。
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../server/db.js");
const { seedDemoData } = await import("../server/demo.js");
const { jstDate } = await import("../src/lib/dates.js");

const BASE = process.argv[2] ?? "http://localhost:3000";
const TEST_PRODUCER = "確認用D農家";

const request = (o: Record<string, unknown> = {}) => ({
  item: "トマト", quantity: 10, unit: "kg", deadline: jstDate(2), region: "大阪近郊", allowIrregular: true, ...o,
});

async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function plan(o: Record<string, unknown> = {}) {
  const { status, data } = await call("/api/plan", "POST", request(o));
  if (status !== 200) throw new Error(`plan ${status}: ${data.error}`);
  return data as { plan: any; version: string };
}

const quantities = async () =>
  Object.fromEntries((await prisma.listing.findMany({ select: { id: true, quantity: true } })).map((l) => [l.id, l.quantity]));

let failed = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "OK " : "NG "} ${label}：${detail}`);
  if (!ok) failed++;
}

const describe = (p: any) =>
  `${p.allocations.map((a: any) => `${a.producerName}${a.quantity}kg`).join("＋") || "なし"}＝${p.totalQuantity}kg、` +
  `商品代${p.subtotal.toLocaleString()}円、受渡手数料${p.handoverFee}円／「${p.message}」`;

async function cleanup() {
  await prisma.listing.deleteMany({ where: { producer: { name: TEST_PRODUCER } } });
  await prisma.producer.deleteMany({ where: { name: TEST_PRODUCER } });
  await seedDemoData(prisma);
}

try {
  await cleanup();

  // 1. 規格外可
  const before = await quantities();
  const r1 = await plan();
  check("1. 規格外可", r1.plan.status === "fulfilled" && r1.plan.totalQuantity === 10 && r1.plan.subtotal === 5350 && r1.plan.handoverFee === 0, describe(r1.plan));
  check("   仕入れ案を作っても在庫は減らない", JSON.stringify(await quantities()) === JSON.stringify(before), "出品の数量は変化なし");

  // 2. 規格外不可
  const r2 = await plan({ allowIrregular: false });
  check("2. 規格外不可", r2.plan.status === "shortage" && r2.plan.totalQuantity === 8 && r2.plan.shortage === 2, describe(r2.plan));

  // 3. C農家を1kgに変更
  const patch = await call("/api/listings/demo-listing-c", "PATCH", { quantity: 1 });
  const r3 = await plan();
  check("3. C農家を1kgに変更", patch.status === 200 && r3.plan.status === "shortage" && r3.plan.totalQuantity === 9 && r3.plan.shortage === 1, describe(r3.plan));
  check("   在庫変更で version が変わる（旧案の無効判定に使う）", r3.version !== r1.version, "変化あり");

  // 4. 受渡条件が合わない出品を組み合わせない（同日・別拠点の出品を追加）
  const add = await call("/api/listings", "POST", {
    producerName: TEST_PRODUCER, item: "トマト", quantity: 5, unit: "kg", unitPrice: 300, availableDate: jstDate(2),
    region: "大阪近郊", handoverPlace: "別の拠点Q", handoverStart: "10:00", handoverEnd: "11:00", minQuantity: 1, step: 1, handoverFee: 0,
  });
  const r4 = await plan();
  const usedQ = r4.plan.allocations.some((a: any) => a.producerName === TEST_PRODUCER);
  check("4. 受渡条件が合わない出品", add.status === 201 && !usedQ && r4.plan.status === "handover_mismatch" && r4.plan.totalQuantity === 9, describe(r4.plan));

  // サーバー側の入力検証
  const bad = await Promise.all([
    call("/api/plan", "POST", request({ quantity: 1.5 })),
    call("/api/plan", "POST", request({ handoverFrom: "11:00", handoverTo: "10:00" })),
    call("/api/listings/demo-listing-a", "PATCH", { quantity: -1 }),
    call("/api/listings", "POST", { producerName: "x", item: "トマト", quantity: 1, unit: "kg", unitPrice: 1, availableDate: jstDate(2), region: "大阪近郊", handoverPlace: "P", handoverStart: "10:00", handoverEnd: "11:00", minQuantity: 1, step: 0 }),
  ]);
  check("   不正な数量・時間・販売刻みは 400", bad.every((b) => b.status === 400), bad.map((b) => b.data.error).join("／"));
} finally {
  await cleanup();
  await prisma.$disconnect();
}

console.log(failed === 0 ? "\nすべて OK（デモデータは初期状態に戻しました）" : `\n${failed} 件 NG`);
process.exitCode = failed === 0 ? 0 : 1;
