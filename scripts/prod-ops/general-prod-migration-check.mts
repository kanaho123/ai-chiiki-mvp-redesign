// 読み取りのみ：一般向け Production DB の migration の状態と、比較用の記録（件数・相談・デモの出品）。値（接続情報）は表示しない。
// usage（リポジトリ直下で）：npx tsx scripts/prod-ops/general-prod-migration-check.mts <out.json> [--compare <before.json>]
// 記録の場所：AIC_OPS_DATA_DIR（既定 ~/.ai-chiiki-ops/demo-data）の 3農家デモの ids.json とケールの kale.json を読む（AIC_DEMO_IDS・AIC_DEMO_KALE でファイル名を変えられる）
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

const ALLOWED = "ep-bitter-credit-b8fbhoir";
const BLOCKED = ["ep-small-base-b7kc2j0a", "ep-sparkling-voice-b77ras92", "ep-hidden-union-b7n46jco", "ep-polished-surf-b82ja29g"];
const env: Record<string, string> = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.general.production.local"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ep = (u?: string) => { try { return new URL(u!).hostname.split(".")[0].replace(/-pooler$/, ""); } catch { return null; } };
if (process.env.VERCEL || process.env.VERCEL_ENV) throw new Error("Vercel 上では実行しない");
if (env.GENERAL_PROD_DB_ENDPOINT !== ALLOWED || ep(env.DATABASE_URL) !== ALLOWED || ep(env.DATABASE_URL_UNPOOLED) !== ALLOWED) throw new Error("一般向け Production DB ではないため中止");
if ([ep(env.DATABASE_URL), ep(env.DATABASE_URL_UNPOOLED)].some((x) => x && BLOCKED.includes(x))) throw new Error("ほかの環境の DB のため中止");

const DATA = process.env.AIC_OPS_DATA_DIR ? resolve(process.env.AIC_OPS_DATA_DIR) : resolve(homedir(), ".ai-chiiki-ops", "demo-data");
const ids = JSON.parse(readFileSync(resolve(DATA, process.env.AIC_DEMO_IDS ?? "20261019091547.ids.json"), "utf8"));
const kale = JSON.parse(readFileSync(resolve(DATA, process.env.AIC_DEMO_KALE ?? "20261020071046.kale.json"), "utf8"));
if (ids.endpoint !== ALLOWED || kale.endpoint !== ALLOWED) throw new Error("記録ファイルの接続先が違う");
const TABLES = ["users", "restaurants", "producers", "producer_items", "items", "varieties", "places", "slot_series", "slot_series_participants", "handover_slots", "slot_participants", "supplies", "approval_requests", "relationships", "auth_throttles", "trade_messages"];
const [outFile] = process.argv.slice(2);
const cmpIdx = process.argv.indexOf("--compare");
const r = (p: string) => pathToFileURL(resolve(process.cwd(), p)).href;
const { PrismaClient } = await import(r("server/generated/prisma/client.ts"));
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL_UNPOOLED });
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
try {
  await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  const where: any[] = await prisma.$queryRawUnsafe(`SELECT current_database() db, now() AS at, pg_current_wal_lsn()::text lsn, current_setting('neon.timeline_id', true) timeline, current_setting('neon.tenant_id', true) tenant`);
  const migs: any[] = await prisma.$queryRawUnsafe(`SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at`);
  const local = readdirSync(resolve(process.cwd(), "prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const applied = migs.filter((m) => m.finished && !m.rolled_back).map((m) => m.migration_name);
  const failed = migs.filter((m) => !m.finished && !m.rolled_back).map((m) => m.migration_name);
  const pending = local.filter((n) => !applied.includes(n));
  const exists = async (t: string) => ((await prisma.$queryRawUnsafe(`SELECT to_regclass('public.${t}') IS NOT NULL AS e`)) as any[])[0].e;
  const counts: Record<string, number | null> = {};
  for (const t of TABLES) counts[t] = (await exists(t)) ? ((await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}"`)) as any[])[0].n : null;
  const receivedAtColumn = ((await prisma.$queryRawUnsafe(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='approval_requests' AND column_name='receivedAt'`)) as any[])[0].n === 1;
  // 相談：中身（状態・数量・価格・日時など）のハッシュ。receivedAt は列の有無に関係なく比べないように、元からある列だけを読む
  const approvals: any[] = await prisma.$queryRawUnsafe(`SELECT id, "restaurantId", "producerId", "supplyId", "planFingerprint", "planVersion", "itemName", "quantityKg", "priceYenPerKg", "subtotalYen", "pickupStartAt", "pickupEndAt", "pickupPlace", status::text, "createdAt", "respondedAt" FROM approval_requests ORDER BY id`);
  const demoApprovals = approvals.filter((a) => a.restaurantId === ids.restaurantUserId || ids.producerIds.includes(a.producerId)).length;
  const supplyRows: any[] = await prisma.$queryRawUnsafe(`SELECT id, "producerId", "itemId", "availableKg", "priceYenPerKg", published, version, "updatedAt", "slotId" FROM supplies WHERE id = ANY($1) ORDER BY id`, [...ids.supplyIds, kale.supplyId]);
  const kaleSupply = supplyRows.find((s) => s.id === kale.supplyId) ?? null;
  const tomato = supplyRows.filter((s) => ids.supplyIds.includes(s.id));
  const snap = {
    at: where[0].at, lsn: where[0].lsn, timeline: where[0].timeline, tenant: where[0].tenant, database: where[0].db,
    migrations: { applied, failed, pending, appliedCount: applied.length },
    counts, receivedAtColumn,
    approvals: { count: approvals.length, demo: demoApprovals, hash: hash(approvals) },
    kaleSupply: kaleSupply ? { id: kaleSupply.id, availableKg: kaleSupply.availableKg, priceYenPerKg: kaleSupply.priceYenPerKg, published: kaleSupply.published, version: kaleSupply.version } : null,
    tomatoSupplies: tomato.map((s) => ({ id: s.id, availableKg: s.availableKg, priceYenPerKg: s.priceYenPerKg, published: s.published, version: s.version, updatedAt: s.updatedAt })),
    supplyHash: hash(supplyRows),
  };
  writeFileSync(outFile, JSON.stringify(snap, null, 1));
  console.log(`接続先：${ALLOWED}（一般向け Production DB・demo Production の ep-small-base… でも dev の ep-polished-surf… でもない）`);
  console.log(`時点：${new Date(snap.at).toISOString()}・LSN ${snap.lsn}・timeline ${snap.timeline ?? "-"}`);
  console.log(`migration：適用済み ${applied.length}件（最後 ${applied.at(-1)}）・失敗 ${failed.length}件・未適用 ${pending.join(", ") || "なし"}`);
  console.log(`件数：${JSON.stringify(counts)}`);
  console.log(`receivedAt 列：${receivedAtColumn ? "あり" : "なし"}・trade_messages：${counts.trade_messages === null ? "なし" : `${counts.trade_messages}件`}`);
  console.log(`相談：${approvals.length}件（デモ ${demoApprovals}件）・ケールの出品：${kaleSupply ? "あり" : "なし"}・トマトの A〜D のデモの出品：${tomato.length}/4件`);
  if (cmpIdx >= 0) {
    const before = JSON.parse(readFileSync(process.argv[cmpIdx + 1], "utf8"));
    const diff = TABLES.filter((t) => before.counts[t] !== counts[t]).map((t) => `${t}:${before.counts[t]}→${counts[t]}`);
    console.log(`前との比較：件数の違い ${diff.join(" ") || "なし"}・相談の中身 ${before.approvals.hash === snap.approvals.hash ? "同じ" : "違う！"}・デモの出品 ${before.supplyHash === snap.supplyHash ? "同じ" : "違う！"}`);
  }
} finally {
  await prisma.$disconnect();
}
