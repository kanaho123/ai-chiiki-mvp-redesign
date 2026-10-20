// 一般向けの DB（--target dev|production）で、デモの店（デモ 食堂（架空））からデモの農家（デモ A〜D農園（架空））へ送った、
// 特定の「返事待ち」の相談（ApprovalRequest）だけを確かめる／消す運用ツール（アプリの本体・Vercel の Functions からは使わない）。
// 例：デモの前に、以前の確認で送ったトマト10kg の相談が残っていて「仕入れ相談する」が出ないとき（2026-10-20 に本番で使用）。
//
// 使い方（リポジトリ直下で。接続情報は ENV_FILE だけから読む・表示しない。ID の記録は AIC_OPS_DATA_DIR（既定 ~/.ai-chiiki-ops/demo-data））：
//   npx tsx scripts/prod-ops/general-demo-approvals.mts inspect --target production --ids <data>/<日時>.ids.json [--kale <data>/<日時>.kale.json]
//       … 読み取りのみ。デモの店の相談を一覧にし、消してよい相談（仕入れ案ごと）と ID を示す
//   npx tsx scripts/prod-ops/general-demo-approvals.mts delete --target production --ids <ids.json> [--kale <kale.json>] --expect-ids <id1,id2,...> --confirm <CONFIRM_DELETE>
//       … 指定した ID の相談だけを 1 トランザクションで消す。出品・品目・生産者・店・場所・回は変えない
//
// 消す条件（1件でも合わなければ何も消さない）：
//   ・指定した ID がすべて、デモの店（記録の ID）からデモの農家（記録の ID）への相談で、出品がデモの出品（記録の ID。--kale ならケールも）
//   ・状態が返事待ち（pending）・受け取り完了なし（receivedAt が null）・やり取り（trade_messages）0件
//   ・同じ仕入れ案（店・planFingerprint）の相談をすべて指定している（仕入れ案の一部だけを消さない）
//   ・指定した ID がもう1件も無ければ、何もせずに終わる（2回目の実行で壊れない）
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── 接続先（--target dev か --target production で選ぶ。指定がなければ動かない） ──
// 接続情報（DATABASE_URL など）は、リポジトリ直下の ENV_FILE（Git 対象外）からだけ読む。ここには書かない
const TARGETS = {
  production: { ALLOWED: "ep-bitter-credit-b8fbhoir", ENV_FILE: ".env.general.production.local", ENDPOINT_KEY: "GENERAL_PROD_DB_ENDPOINT", CONFIRM_DELETE: "GENERAL_PRODUCTION_DEMO_APPROVALS_DELETE", LABEL: "一般向け Production DB" },
  dev: { ALLOWED: "ep-polished-surf-b82ja29g", ENV_FILE: ".env.general.local", ENDPOINT_KEY: "GENERAL_DB_ENDPOINT", CONFIRM_DELETE: "GENERAL_DEV_DEMO_APPROVALS_DELETE", LABEL: "一般向け dev DB" },
} as const;
const KNOWN_ENDPOINTS = ["ep-small-base-b7kc2j0a", "ep-sparkling-voice-b77ras92", "ep-hidden-union-b7n46jco", "ep-polished-surf-b82ja29g", "ep-bitter-credit-b8fbhoir"];
const targetName = (() => { const i = process.argv.indexOf("--target"); return i >= 0 ? process.argv[i + 1] : undefined; })();
if (targetName !== "dev" && targetName !== "production") {
  console.error("中止：--target dev か --target production を指定してください");
  process.exit(1);
}
const T = TARGETS[targetName];
const ALLOWED = T.ALLOWED;
const BLOCKED = KNOWN_ENDPOINTS.filter((e) => e !== ALLOWED);
// ── ここまで ──

class Guard extends Error {}
const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
let prisma: any = null;
type Ids = { endpoint: string; userIds: string[]; producerIds: string[]; restaurantUserId: string | null; supplyIds: string[] };

async function connect() {
  if (process.env.VERCEL || process.env.VERCEL_ENV) throw new Guard("Vercel 上では実行しない");
  const env: Record<string, string> = {};
  for (const line of readFileSync(resolve(process.cwd(), T.ENV_FILE), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const ep = (u?: string) => { try { return new URL(u!).hostname.split(".")[0].replace(/-pooler$/, ""); } catch { return null; } };
  if (env[T.ENDPOINT_KEY] !== ALLOWED || ep(env.DATABASE_URL) !== ALLOWED || ep(env.DATABASE_URL_UNPOOLED) !== ALLOWED) throw new Guard(`${T.LABEL} と確認できないため中止`);
  if ([ep(env.DATABASE_URL), ep(env.DATABASE_URL_UNPOOLED)].some((x) => x && BLOCKED.includes(x))) throw new Guard("ほかの環境の DB のため中止");
  const { PrismaClient } = await import(pathToFileURL(resolve(process.cwd(), "server/generated/prisma/client.ts")).href);
  prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL_UNPOOLED });
  console.log(`接続先：${ALLOWED}（${T.LABEL}）・モード：${mode}`);
}

const readJson = (p: string) => JSON.parse(readFileSync(resolve(p), "utf8"));

async function main() {
  if (mode !== "inspect" && mode !== "delete") throw new Guard("モードは inspect / delete");
  if (!opt("--ids")) throw new Guard("--ids <デモの ids.json> が必要（デモの店・農家・出品を ID で確かめるため）");
  if (mode === "delete" && opt("--confirm") !== T.CONFIRM_DELETE) throw new Guard(`削除には --confirm ${T.CONFIRM_DELETE} が必要`);
  if (mode === "delete" && !opt("--expect-ids")) throw new Guard("削除には --expect-ids <id1,id2,...> が必要（inspect で確かめた ID）");
  const ids = readJson(opt("--ids")!) as Ids;
  if (ids.endpoint !== ALLOWED) throw new Guard("ids.json の接続先が違うため中止");
  if (!ids.restaurantUserId) throw new Guard("ids.json にデモの店がない");
  const kale = opt("--kale") ? readJson(opt("--kale")!) as { endpoint: string; supplyId: string } : null;
  if (kale && kale.endpoint !== ALLOWED) throw new Guard("kale.json の接続先が違うため中止");
  const demoSupplies = [...ids.supplyIds, ...(kale ? [kale.supplyId] : [])];
  await connect();

  /** 1件ごとの条件（読み取り） */
  const rowProblems = async (tx: any, r: any) => {
    const p: string[] = [];
    if (r.restaurantId !== ids.restaurantUserId) p.push("店がデモの店ではない");
    if (!ids.producerIds.includes(r.producerId)) p.push("生産者がデモの農家ではない");
    if (!demoSupplies.includes(r.supplyId)) p.push("出品がデモの出品ではない");
    if (r.status !== "pending") p.push(`返事待ちではない（${r.status}）`);
    if (r.receivedAt !== null) p.push("受け取り完了あり");
    const messages = await tx.tradeMessage.count({ where: { approvalRequestId: r.id } });
    if (messages > 0) p.push(`やり取り ${messages}件`);
    return p;
  };
  const shop = await prisma.user.findUnique({ where: { id: ids.restaurantUserId }, select: { displayName: true, email: true } });
  if (!shop || shop.displayName !== "デモ 食堂（架空）" || !shop.email?.endsWith("@example.invalid")) throw new Guard("デモの店が記録と違うため中止");

  if (mode === "inspect") {
    const rows = await prisma.approvalRequest.findMany({ where: { restaurantId: ids.restaurantUserId }, orderBy: [{ planFingerprint: "asc" }, { id: "asc" }] });
    const producers = new Map((await prisma.producer.findMany({ where: { id: { in: ids.producerIds } }, select: { id: true, farmName: true } })).map((p: any) => [p.id, p.farmName]));
    const toDemo = await prisma.approvalRequest.count({ where: { producerId: { in: ids.producerIds }, NOT: { restaurantId: ids.restaurantUserId } } });
    console.log(`デモの店の相談：${rows.length}件・デモの農家への、ほかの店からの相談：${toDemo}件（このツールでは扱わない）`);
    const groups = new Map<string, any[]>();
    for (const r of rows) groups.set(r.planFingerprint, [...(groups.get(r.planFingerprint) ?? []), r]);
    for (const [fp, list] of groups) {
      const problems: string[] = [];
      for (const r of list) {
        const p = await rowProblems(prisma, r);
        console.log(`  ${r.id}：${producers.get(r.producerId) ?? r.producerId}・${r.itemName} ${r.quantityKg}kg・${r.status}・receivedAt ${r.receivedAt ?? "null"}${p.length ? `・NG（${p.join("・")}）` : ""}`);
        problems.push(...p);
      }
      console.log(`  → 仕入れ案 ${fp.slice(0, 12)}…（${list.length}件・合計 ${list.reduce((n, r) => n + r.quantityKg, 0)}kg）：${problems.length ? "消さない" : `消してよい。--expect-ids ${list.map((r) => r.id).join(",")}`}`);
    }
    return;
  }

  const expected = [...new Set(opt("--expect-ids")!.split(",").map((x) => x.trim()).filter(Boolean))].sort();
  const out = await prisma.$transaction(async (tx: any) => {
    const rows = await tx.approvalRequest.findMany({ where: { id: { in: expected } } });
    if (rows.length === 0) return { deleted: 0, note: "指定した相談はもうありません（何もしない）" };
    if (rows.length !== expected.length) throw new Guard(`指定した ID の一部だけが残っているため、何も消さない（残り ${rows.length}/${expected.length}件）`);
    for (const r of rows) {
      const p = await rowProblems(tx, r);
      if (p.length) throw new Guard(`${r.id} が条件に合わないため、何も消さない：${p.join("・")}`);
    }
    // 同じ仕入れ案（店・planFingerprint）の相談をすべて指定しているか（一部だけを消さない）
    for (const fp of new Set(rows.map((r: any) => r.planFingerprint))) {
      const all = await tx.approvalRequest.findMany({ where: { restaurantId: ids.restaurantUserId, planFingerprint: fp }, select: { id: true } });
      const missing = all.map((a: any) => a.id).filter((id: string) => !expected.includes(id));
      if (missing.length) throw new Guard(`同じ仕入れ案の相談 ${missing.join(",")} が指定されていないため、何も消さない`);
    }
    const n = await tx.approvalRequest.deleteMany({ where: { id: { in: expected }, restaurantId: ids.restaurantUserId, status: "pending", receivedAt: null } });
    if (n.count !== expected.length) throw new Guard(`削除件数が ${n.count}/${expected.length} 件のため取り消した`);
    return { deleted: n.count, note: expected.join(", ") };
  }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 20_000 });
  console.log(`削除しました：相談 ${out.deleted}件（${out.note}）`);
}

try {
  await main();
} catch (e) {
  if (e instanceof Guard) { console.error(`中止：${e.message}`); process.exitCode = 1; }
  else { console.error(`失敗：${(e as Error).name}（何も変更していないか、トランザクションで取り消されています）`); process.exitCode = 1; }
} finally {
  await prisma?.$disconnect();
}
