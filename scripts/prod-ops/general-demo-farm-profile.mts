// 一般向けの DB（--target dev|production）で、3農家デモの「デモ A農園（架空）」の生産者プロフィールのうち、
// 通常の登録なら入っている4項目（生産のスタイル・飲食店との直接取引の経験・対応できること・今の販売先）だけを補う／元に戻す運用ツール。
// 変えるのは producers の A農園の1行の、productionStyle・directTradeExperience・capabilities・salesChannels だけ（updatedAt は自動で変わる）。
// 市区町村・主な作物（producer_items）・ユーザー・出品・場所・受け渡しの回・相談・やり取りなど、ほかの行・列は変えない。
//
// 使い方（リポジトリ直下で。接続情報は ENV_FILE だけから読む・表示しない。記録は AIC_OPS_DATA_DIR（既定 ~/.ai-chiiki-ops/demo-data））：
//   npx tsx scripts/prod-ops/general-demo-farm-profile.mts inspect --target production --ids <data>/<日時>.ids.json
//       … 読み取りのみ。今の4項目と、設定する値、「あなたの販売スタイル」の変更前後、対象外のデータの指紋を表示する
//   npx tsx scripts/prod-ops/general-demo-farm-profile.mts set --target production --ids <ids.json> --confirm <CONFIRM_SET>
//       … 4項目だけを設定し、変更前の値を <data>/<日時>.farm-a-profile.before.json に保存する（Git に入れない）。
//         すでに設定済みなら何もしない。対象外のデータ・全テーブルの件数が変わったら取り消す
//   npx tsx scripts/prod-ops/general-demo-farm-profile.mts rollback --target production --ids <ids.json> --before <before.json> --confirm <CONFIRM_ROLLBACK>
//       … 4項目と updatedAt を変更前に戻す。今の値がこのツールで設定した値のままのときだけ戻す（2回目は何もしない）
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── 接続先（--target dev か --target production で選ぶ。指定がなければ動かない） ──
const TARGETS = {
  production: {
    ALLOWED: "ep-bitter-credit-b8fbhoir", ENV_FILE: ".env.general.production.local", ENDPOINT_KEY: "GENERAL_PROD_DB_ENDPOINT", LABEL: "一般向け Production DB",
    CONFIRM_SET: "GENERAL_PRODUCTION_DEMO_FARM_A_PROFILE_SET", CONFIRM_ROLLBACK: "GENERAL_PRODUCTION_DEMO_FARM_A_PROFILE_ROLLBACK",
  },
  dev: {
    ALLOWED: "ep-polished-surf-b82ja29g", ENV_FILE: ".env.general.local", ENDPOINT_KEY: "GENERAL_DB_ENDPOINT", LABEL: "一般向け dev DB",
    CONFIRM_SET: "GENERAL_DEV_DEMO_FARM_A_PROFILE_SET", CONFIRM_ROLLBACK: "GENERAL_DEV_DEMO_FARM_A_PROFILE_ROLLBACK",
  },
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
const OUT_DIR = process.env.AIC_OPS_DATA_DIR ? resolve(process.env.AIC_OPS_DATA_DIR) : resolve(homedir(), ".ai-chiiki-ops", "demo-data");
// ── ここまで ──

const FARM_A = "デモ A農園（架空）";
/** 設定する値（通常の登録で入る4項目） */
const NEW = { productionStyle: "many_small", directTradeExperience: "sometimes", capabilities: ["small_lot", "direct_talk"], salesChannels: ["direct_store"] } as const;
type Four = { productionStyle: string | null; directTradeExperience: string | null; capabilities: string[]; salesChannels: string[] };
const FIELDS = ["productionStyle", "directTradeExperience", "capabilities", "salesChannels"] as const;
const TABLES = ["users", "restaurants", "producers", "producer_items", "items", "varieties", "places", "slot_series", "slot_series_participants", "handover_slots", "slot_participants", "supplies", "approval_requests", "relationships", "auth_throttles", "trade_messages"];
class Guard extends Error {}
const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
let prisma: any = null;
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? String(v) : v))).digest("hex").slice(0, 16);
const four = (p: any): Four => ({ productionStyle: p.productionStyle, directTradeExperience: p.directTradeExperience, capabilities: [...p.capabilities], salesChannels: [...p.salesChannels] });
const same = (a: Four, b: Four) => JSON.stringify(a) === JSON.stringify(b);

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

/** 対象（A農園とそのユーザー）の確認。想定外があれば止める（読み取り） */
async function target(tx: any, ids: { producerIds: string[]; userIds: string[] }) {
  const producers = await tx.producer.findMany({ where: { farmName: FARM_A } });
  const a = producers.find((p: any) => ids.producerIds.includes(p.id));
  const problems: string[] = [];
  if (producers.length !== 1) problems.push(`「${FARM_A}」の生産者が ${producers.length}件（1件のはず）`);
  if (!a) problems.push("A農園の ID がデモの記録にない");
  const user = a ? await tx.user.findUnique({ where: { id: a.ownerUserId }, select: { id: true, role: true, email: true } }) : null;
  if (a && !user) problems.push("A農園のユーザーがない");
  if (user) {
    if (!ids.userIds.includes(user.id)) problems.push("A農園のユーザーの ID がデモの記録にない");
    if (user.role !== "producer") problems.push(`ユーザーの役割が producer ではない（${user.role}）`);
    if (!user.email?.startsWith("demo-farm-a-") || !user.email.endsWith("@example.invalid")) problems.push("メールがデモ用（demo-farm-a-…@example.invalid）ではない");
  }
  return { a, user, problems };
}

/** 変えてはいけないデータの指紋：全テーブルの件数・A農園のユーザー・4項目と updatedAt 以外の生産者の列・主な作物・出品・場所・受け渡しの回・相談・やり取り */
async function others(tx: any, a: any) {
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = ((await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}"`)) as any[])[0].n;
  const rest = { ...a };
  for (const f of [...FIELDS, "updatedAt"]) delete rest[f];
  const parts = {
    user: await tx.user.findUnique({ where: { id: a.ownerUserId } }),
    producer: rest,
    mainItems: await tx.producerItem.findMany({ where: { producerId: a.id }, orderBy: { itemId: "asc" } }),
    supplies: await tx.supply.findMany({ where: { producerId: a.id }, orderBy: { id: "asc" } }),
    places: await tx.place.findMany({ where: { ownerProducerId: a.id }, orderBy: { id: "asc" } }),
    series: await tx.slotSeriesParticipant.findMany({ where: { producerId: a.id }, orderBy: { seriesId: "asc" } }),
    slots: await tx.slotParticipant.findMany({ where: { producerId: a.id }, orderBy: { slotId: "asc" } }),
    approvals: await tx.approvalRequest.findMany({ where: { producerId: a.id }, orderBy: { id: "asc" } }),
    messages: await tx.tradeMessage.findMany({ where: { approvalRequest: { producerId: a.id } }, orderBy: { id: "asc" } }),
  };
  return { counts, hash: hash(parts), partHashes: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, hash(v)])) };
}

async function styleOf(f: Four) {
  const { producerStyle } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/onboarding.ts")).href);
  return producerStyle({ capabilities: f.capabilities, salesChannels: f.salesChannels, productionStyle: f.productionStyle ?? "", directTradeExperience: f.directTradeExperience ?? "" });
}

async function main() {
  if (!["inspect", "set", "rollback"].includes(mode)) throw new Guard("モードは inspect / set / rollback");
  if (!opt("--ids")) throw new Guard("--ids <デモの ids.json> が必要");
  if (mode === "set" && opt("--confirm") !== T.CONFIRM_SET) throw new Guard(`設定には --confirm ${T.CONFIRM_SET} が必要`);
  if (mode === "rollback" && opt("--confirm") !== T.CONFIRM_ROLLBACK) throw new Guard(`元に戻すには --confirm ${T.CONFIRM_ROLLBACK} が必要`);
  if (mode === "rollback" && !opt("--before")) throw new Guard("元に戻すには --before <before.json> が必要");
  const ids = JSON.parse(readFileSync(resolve(opt("--ids")!), "utf8"));
  if (ids.endpoint !== ALLOWED) throw new Guard("ids.json の接続先が違うため中止");
  await connect();

  if (mode === "inspect") {
    const t = await target(prisma, ids);
    if (t.a) {
      const cur = four(t.a);
      const o = await others(prisma, t.a);
      console.log(`生産者：${FARM_A}（ID はデモの記録と一致）・ユーザー ${t.user?.email ?? "なし"}`);
      console.log(`今の4項目：${JSON.stringify(cur)}`);
      console.log(`設定する値：${JSON.stringify(NEW)}${same(cur, NEW as unknown as Four) ? "（設定済み）" : ""}`);
      console.log(`あなたの販売スタイル：今「${await styleOf(cur)}」→ 設定後「${await styleOf(NEW as unknown as Four)}」`);
      console.log(`ほかの列（変えない）：市区町村 ${t.a.city}・生産者名 ${t.a.producerName}・その他の作物 ${t.a.otherCrops ?? "なし"}・updatedAt ${t.a.updatedAt.toISOString()}`);
      console.log(`対象外のデータの指紋：${o.hash}（${Object.entries(o.partHashes).map(([k, v]) => `${k} ${v}`).join("・")}）`);
      console.log(`件数：${JSON.stringify(o.counts)}`);
    }
    console.log(t.problems.length ? `→ 想定外：${t.problems.join(" / ")}` : "→ 想定どおり（A農園の生産者の4項目だけを変更すればよい）");
    if (t.problems.length) process.exitCode = 2;
    return;
  }

  if (mode === "set") {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const out = await prisma.$transaction(async (tx: any) => {
      const t = await target(tx, ids);
      if (t.problems.length) throw new Guard(`想定外のため何も変えない：${t.problems.join(" / ")}`);
      const before = four(t.a);
      if (same(before, NEW as unknown as Four)) return { changed: 0 as const, note: "すでに設定済み（何もしない）" };
      const o0 = await others(tx, t.a);
      const n = await tx.producer.updateMany({
        where: { id: t.a.id, ownerUserId: t.a.ownerUserId, productionStyle: before.productionStyle, directTradeExperience: before.directTradeExperience, capabilities: { equals: before.capabilities }, salesChannels: { equals: before.salesChannels } },
        data: { productionStyle: NEW.productionStyle, directTradeExperience: NEW.directTradeExperience, capabilities: [...NEW.capabilities], salesChannels: [...NEW.salesChannels] },
      });
      if (n.count !== 1) throw new Guard(`更新が ${n.count}件のため取り消した`);
      const after = await tx.producer.findUnique({ where: { id: t.a.id } });
      const o1 = await others(tx, after);
      if (o0.hash !== o1.hash || JSON.stringify(o0.counts) !== JSON.stringify(o1.counts)) throw new Guard("対象外のデータか件数が変わったため取り消した");
      if (!same(four(after), NEW as unknown as Four)) throw new Guard("設定後の値が想定と違うため取り消した");
      return { changed: 1 as const, producerId: t.a.id, before, previousUpdatedAt: t.a.updatedAt.toISOString(), othersHash: o0.hash };
    }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 20_000 });
    if (out.changed === 0) { console.log(out.note); return; }
    mkdirSync(OUT_DIR, { recursive: true });
    const beforeFile = resolve(OUT_DIR, `${stamp}.farm-a-profile.before.json`);
    writeFileSync(beforeFile, JSON.stringify({ endpoint: ALLOWED, producerId: out.producerId, before: out.before, previousUpdatedAt: out.previousUpdatedAt, set: NEW, othersHash: out.othersHash, at: new Date().toISOString() }, null, 1), { flag: "wx", mode: 0o600 });
    try { chmodSync(beforeFile, 0o600); } catch {}
    console.log(`設定しました：${FARM_A} の4項目だけ ${JSON.stringify(out.before)} → ${JSON.stringify(NEW)}（対象外のデータ・件数は変わっていない）`);
    console.log(`元に戻すための記録：${beforeFile}`);
    return;
  }

  // rollback：4項目と updatedAt を変更前に戻す
  const rec = JSON.parse(readFileSync(resolve(opt("--before")!), "utf8"));
  if (rec.endpoint !== ALLOWED) throw new Guard("before.json の接続先が違うため中止");
  const out = await prisma.$transaction(async (tx: any) => {
    const t = await target(tx, ids);
    if (t.problems.length) throw new Guard(`想定外のため何も変えない：${t.problems.join(" / ")}`);
    if (t.a.id !== rec.producerId) throw new Guard("記録の生産者と違うため何も変えない");
    const cur = four(t.a);
    if (same(cur, rec.before)) return { changed: 0, note: "すでに変更前の状態（何もしない）" };
    if (!same(cur, rec.set)) throw new Guard("このツールで設定したあとに4項目が変わっているため、何も変えない");
    const o0 = await others(tx, t.a);
    const n = await tx.producer.updateMany({
      where: { id: t.a.id, productionStyle: cur.productionStyle, directTradeExperience: cur.directTradeExperience, capabilities: { equals: cur.capabilities }, salesChannels: { equals: cur.salesChannels } },
      data: { productionStyle: rec.before.productionStyle, directTradeExperience: rec.before.directTradeExperience, capabilities: rec.before.capabilities, salesChannels: rec.before.salesChannels, updatedAt: new Date(rec.previousUpdatedAt) },
    });
    if (n.count !== 1) throw new Guard(`更新が ${n.count}件のため取り消した`);
    const after = await tx.producer.findUnique({ where: { id: t.a.id } });
    const o1 = await others(tx, after);
    if (o0.hash !== o1.hash || JSON.stringify(o0.counts) !== JSON.stringify(o1.counts)) throw new Guard("対象外のデータか件数が変わったため取り消した");
    return { changed: 1, note: `4項目を ${JSON.stringify(rec.before)}・updatedAt を ${rec.previousUpdatedAt} に戻した` };
  }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 20_000 });
  console.log(`元に戻しました：${out.changed}件・${out.note}`);
}

try {
  await main();
} catch (e) {
  if (e instanceof Guard) { console.error(`中止：${e.message}`); process.exitCode = 1; }
  else { console.error(`失敗：${(e as Error).name}（何も変更していないか、トランザクションで取り消されています）`); process.exitCode = 1; }
} finally {
  await prisma?.$disconnect();
}
