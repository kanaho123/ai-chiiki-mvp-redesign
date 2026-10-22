// 一般向けの DB（--target dev|production）の3農家デモ（デモ A〜D農園（架空））に、AI の代替候補の補足デモ用「ケール」の出品を1件足す／消す。
// 運用用のツール（アプリの本体・Vercel の Functions からは使わない）。どのコマンドにも --target dev か --target production を付ける。
// ID の記録はリポジトリの外（既定は ~/.ai-chiiki-ops/demo-data）に保存する。手順は scripts/prod-ops/README.md。
// 既存の行は更新しない（新規追加だけ）。受け渡しの回・場所・参加は作らない。消すときは、このスクリプトが作った行だけを消す。
//
// 使い方（リポジトリ直下で。接続情報は ENV_FILE だけから読む・表示しない）：
//   npx tsx scripts/prod-ops/general-demo-kale.mts precheck --ids <デモの ids.json> --snap <out.json>   … 読み取りのみ。追加前の確認と、比較用の記録（件数・トマトのデモの出品）
//   npx tsx scripts/prod-ops/general-demo-kale.mts insert --ids <デモの ids.json> --confirm <CONFIRM_INSERT> … 1 トランザクションで追加し、作った行の ID を <記録の保存先>/<日時>.kale.json に保存
//   npx tsx scripts/prod-ops/general-demo-kale.mts verify --ids <デモの ids.json> --snap <before.json> [--kale <kale.json>] … 読み取りのみ。追加前の記録と比べる
//   npx tsx scripts/prod-ops/general-demo-kale.mts inspect --kale <kale.json> --ids <デモの ids.json>   … 読み取りのみ
//   npx tsx scripts/prod-ops/general-demo-kale.mts delete --kale <kale.json> --ids <デモの ids.json> --confirm <CONFIRM_DELETE>
//       … ケールの取引（やり取り → 相談）→ 出品 → 品種 → 品目（このスクリプトが作ったときだけ）を 1 トランザクションで消す。
//         デモの店とデモ A農園以外の相談・送り手、同じ仕入れ案のほかの出品があれば何も消さない。2回目は何もしない
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

// ── 接続先（--target dev か --target production で選ぶ。指定がなければ動かない） ──
// 接続情報（DATABASE_URL など）は、リポジトリ直下の ENV_FILE（Git 対象外）からだけ読む。ここには書かない
const TARGETS = {
  production: {
    ALLOWED: "ep-bitter-credit-b8fbhoir", ENV_FILE: ".env.general.production.local", ENDPOINT_KEY: "GENERAL_PROD_DB_ENDPOINT",
    CONFIRM_INSERT: "GENERAL_PRODUCTION_DEMO_KALE_INSERT", CONFIRM_DELETE: "GENERAL_PRODUCTION_DEMO_KALE_DELETE", LABEL: "一般向け Production DB",
  },
  dev: {
    ALLOWED: "ep-polished-surf-b82ja29g", ENV_FILE: ".env.general.local", ENDPOINT_KEY: "GENERAL_DB_ENDPOINT",
    CONFIRM_INSERT: "GENERAL_DEV_DEMO_KALE_INSERT", CONFIRM_DELETE: "GENERAL_DEV_DEMO_KALE_DELETE", LABEL: "一般向け dev DB",
  },
} as const;
// どの接続先でも、ほかの環境の DB（demo Production・demo dev・元のリポジトリの DB など）なら止める
const KNOWN_ENDPOINTS = ["ep-small-base-b7kc2j0a", "ep-sparkling-voice-b77ras92", "ep-hidden-union-b7n46jco", "ep-polished-surf-b82ja29g", "ep-bitter-credit-b8fbhoir"];
const targetName = (() => { const i = process.argv.indexOf("--target"); return i >= 0 ? process.argv[i + 1] : undefined; })();
if (targetName !== "dev" && targetName !== "production") {
  console.error("中止：--target dev か --target production を指定してください");
  process.exit(1);
}
const T = TARGETS[targetName];
const ALLOWED = T.ALLOWED;
const BLOCKED = KNOWN_ENDPOINTS.filter((e) => e !== ALLOWED);
const ENV_FILE = T.ENV_FILE;
const ENDPOINT_KEY = T.ENDPOINT_KEY;
const CONFIRM_INSERT = T.CONFIRM_INSERT;
const CONFIRM_DELETE = T.CONFIRM_DELETE;
const LABEL = T.LABEL;
// ── ここまで ──

// ID・ログイン情報などの記録の保存先：リポジトリの外（Git に入れない）。既定は ~/.ai-chiiki-ops/demo-data
const OUT_DIR = process.env.AIC_OPS_DATA_DIR ? resolve(process.env.AIC_OPS_DATA_DIR) : resolve(homedir(), ".ai-chiiki-ops", "demo-data");

const ITEM = "ケール";
const VARIETY = "指定なし";
const SUPPLY = { kg: 3, price: 800, origin: "大阪府" };
const FARM_A = "デモ A農園（架空）";
const PLACE_X = "デモ みどり坂ふれあい直売所（架空）";
const SLOT_X = { start: "2026-10-27T00:00:00.000Z", deadline: "2026-10-26T07:00:00.000Z" }; // 火 9:00〜11:00 JST・締切 10/26 16:00 JST
// 「黒キャベツ」の候補に影響しそうな具体的な近い品目（出品中なら追加を止める）
const NEAR = ["キャベツ", "黒キャベツ", "小松菜", "白菜", "ケール", "カーボロネロ", "ちりめんキャベツ", "芽キャベツ", "紫キャベツ", "春キャベツ", "レタス", "ほうれん草", "チンゲン菜", "水菜", "春菊", "青梗菜", "菜の花", "ルッコラ", "からし菜", "高菜", "ブロッコリー", "カリフラワー"];
const TABLES = ["users", "restaurants", "producers", "producer_items", "items", "varieties", "places", "slot_series", "slot_series_participants", "handover_slots", "slot_participants", "supplies", "approval_requests", "relationships", "auth_throttles"];

class Guard extends Error {}
const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const say = (s: string) => console.log(s);
let prisma: any = null;

type Kale = { stamp: string; endpoint: string; supplyId: string; itemId: string; varietyId: string; createdItem: boolean; producerId: string; slotId: string };
type Ids = { endpoint: string; producerIds: string[]; seriesIds: string[]; supplyIds: string[] };

async function connect() {
  if (process.env.VERCEL || process.env.VERCEL_ENV) throw new Guard("Vercel 上では実行しない");
  const env: Record<string, string> = {};
  for (const line of readFileSync(resolve(process.cwd(), ENV_FILE), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const ep = (u?: string) => { try { return new URL(u!).hostname.split(".")[0].replace(/-pooler$/, ""); } catch { return null; } };
  if (env[ENDPOINT_KEY] !== ALLOWED || ep(env.DATABASE_URL) !== ALLOWED || ep(env.DATABASE_URL_UNPOOLED) !== ALLOWED) throw new Guard(`${LABEL} と確認できないため中止`);
  if ([ep(env.DATABASE_URL), ep(env.DATABASE_URL_UNPOOLED)].some((x) => x && BLOCKED.includes(x))) throw new Guard("ほかの環境の DB のため中止");
  if (env.DATABASE_URL_UNPOOLED.includes("-pooler.")) throw new Guard("直接接続の URL ではないため中止");
  const url = new URL(env.DATABASE_URL_UNPOOLED);
  url.searchParams.set("connection_limit", "1");
  const { PrismaClient } = await import(pathToFileURL(resolve(process.cwd(), "server/generated/prisma/client.ts")).href);
  prisma = new PrismaClient({ datasourceUrl: url.toString() });
  say(`接続先：${ALLOWED}（${LABEL}）・モード：${mode}`);
}

const readIds = () => {
  const ids = JSON.parse(readFileSync(opt("--ids")!, "utf8")) as Ids;
  if (ids.endpoint !== ALLOWED) throw new Guard("ids.json の接続先が違うため中止");
  return ids;
};

/** 追加の前提（読み取り）：A農園・デモの回・参加・締切・同じ出品 */
async function target(tx: any, ids: Ids, itemKey: (s: string) => string) {
  const a = await tx.producer.findFirst({ where: { id: { in: ids.producerIds }, farmName: FARM_A }, select: { id: true } });
  const slot = await tx.handoverSlot.findFirst({ where: { seriesId: { in: ids.seriesIds }, startAt: new Date(SLOT_X.start), place: { name: PLACE_X } }, select: { id: true, confirmDeadlineAt: true, startAt: true, endAt: true } });
  const joined = a && slot ? await tx.slotParticipant.count({ where: { slotId: slot.id, producerId: a.id } }) : 0;
  const items = await tx.item.findMany({ include: { varieties: true } });
  const kaleItem = items.find((i: any) => itemKey(i.name) === itemKey(ITEM)) ?? null;
  const dup = a && slot && kaleItem ? await tx.supply.count({ where: { producerId: a.id, itemId: kaleItem.id, slotId: slot.id } }) : 0;
  return { a, slot, joined, kaleItem, dup };
}

/** 比較用の記録：全テーブルの件数・トマトのデモの出品の中身・品目と品種の一覧 */
async function snapshot(ids: Ids) {
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
  const demoSupplies = await prisma.supply.findMany({ where: { id: { in: ids.supplyIds } }, select: { id: true, itemId: true, availableKg: true, priceYenPerKg: true, published: true, version: true, updatedAt: true, slotId: true }, orderBy: { id: "asc" } });
  const items = await prisma.item.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } });
  const varieties = await prisma.variety.findMany({ select: { id: true, itemId: true, name: true }, orderBy: { id: "asc" } });
  return { counts, demoSupplies: demoSupplies.map((s: any) => ({ ...s, updatedAt: s.updatedAt.toISOString() })), items, varieties };
}

async function main() {
  if (!["precheck", "insert", "verify", "inspect", "delete"].includes(mode)) throw new Guard("モードは precheck / insert / verify / inspect / delete のどれか");
  if (mode === "insert" && opt("--confirm") !== CONFIRM_INSERT) throw new Guard(`追加には --confirm ${CONFIRM_INSERT} が必要`);
  if (mode === "delete" && opt("--confirm") !== CONFIRM_DELETE) throw new Guard(`削除には --confirm ${CONFIRM_DELETE} が必要`);
  if (["precheck", "insert", "verify"].includes(mode) && !opt("--ids")) throw new Guard("--ids <デモの ids.json> が必要");
  if (["precheck", "verify"].includes(mode) && !opt("--snap")) throw new Guard("--snap <json> が必要");
  if (["inspect", "delete"].includes(mode) && !opt("--kale")) throw new Guard("--kale <kale.json> が必要");
  await connect();
  const { itemKey } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/items.ts")).href);

  if (mode === "precheck") {
    const ids = readIds();
    const t = await target(prisma, ids, itemKey);
    const now = new Date();
    say(`1・2 接続先：${ALLOWED}（一般向け Production。demo Production の ep-small-base… ではない）`);
    say(`3 ${FARM_A}：${t.a ? "あり" : "なし"}・デモの回（10/27 9:00〜11:00・${PLACE_X}）：${t.slot ? "あり" : "なし"}・参加：${t.joined === 1 ? "している" : "していない"}`);
    say(`4 締切：${t.slot ? t.slot.confirmDeadlineAt.toISOString() : "-"}（今 ${now.toISOString()}）→ ${t.slot && t.slot.confirmDeadlineAt > now ? "まだ過ぎていない" : "過ぎている"}`);
    say(`5 品目「ケール」：${t.kaleItem ? `あり（${t.kaleItem.name}）` : "なし（追加時に作る）"}・同じ出品：${t.dup}件`);
    const listed = await prisma.item.findMany({
      where: { supplies: { some: { published: true, availableKg: { gt: 0 }, slot: { confirmDeadlineAt: { gt: now } } } } },
      select: { name: true, _count: { select: { supplies: { where: { published: true, availableKg: { gt: 0 }, slot: { confirmDeadlineAt: { gt: now } } } } } } },
      orderBy: { name: "asc" },
    });
    say(`6 いま出品中の品目（公開・残りあり・締切前）：${listed.map((i: any) => `${i.name}（${i._count.supplies}件）`).join("・") || "なし"}`);
    const near = listed.filter((i: any) => NEAR.some((n) => itemKey(i.name).includes(itemKey(n)) || itemKey(n).includes(itemKey(i.name))));
    say(`  近い品目：${near.length ? near.map((i: any) => i.name).join("・") : "なし"}`);
    writeFileSync(opt("--snap")!, JSON.stringify(await snapshot(ids), null, 2));
    say(`比較用の記録：${opt("--snap")}`);
    const ok = t.a && t.slot && t.joined === 1 && t.slot.confirmDeadlineAt > now && t.dup === 0 && near.length === 0;
    say(ok ? "→ 追加してよい状態" : "→ 追加を止める条件あり");
    if (!ok) process.exitCode = 2;
    return;
  }

  if (mode === "insert") {
    if (Date.now() >= Date.parse(SLOT_X.deadline)) throw new Guard("デモの回の確認締切を過ぎているため中止");
    const ids = readIds();
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const out = await prisma.$transaction(async (tx: any) => {
      const t = await target(tx, ids, itemKey);
      if (!t.a) throw new Guard(`${FARM_A} が見つからない`);
      if (!t.slot) throw new Guard("デモの回（10/27 9:00〜11:00・場所 X）が見つからない");
      if (t.slot.confirmDeadlineAt <= new Date()) throw new Guard("デモの回の確認締切を過ぎている");
      if (t.joined !== 1) throw new Guard(`${FARM_A} がデモの回に参加していない`);
      if (t.dup) throw new Guard("同じ出品がすでにある");
      let item = t.kaleItem, createdItem = false;
      if (!item) {
        item = await tx.item.create({ data: { name: ITEM, varieties: { create: { name: VARIETY } } }, include: { varieties: true } });
        createdItem = true;
      }
      const variety = item.varieties.find((v: any) => v.name === VARIETY);
      if (!variety) throw new Guard(`品目「${item.name}」に品種「${VARIETY}」がない（既存の行は変えないため中止）`);
      const s = await tx.supply.create({ data: { producerId: t.a.id, itemId: item.id, varietyId: variety.id, grade: "regular", originPrefecture: SUPPLY.origin, availableKg: SUPPLY.kg, priceYenPerKg: SUPPLY.price, minKg: 1, slotId: t.slot.id, published: true } });
      return { stamp, endpoint: ALLOWED, supplyId: s.id, itemId: item.id, varietyId: variety.id, createdItem, producerId: t.a.id, slotId: t.slot.id } satisfies Kale;
    }, { timeout: 60_000, maxWait: 20_000 });
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    const file = resolve(OUT_DIR, `${stamp}.kale.json`);
    writeFileSync(file, JSON.stringify(out, null, 2));
    say(`追加しました：出品 1件${out.createdItem ? "・品目 1件・品種 1件（新しく作成）" : "（品目「ケール」は既存を使用）"}`);
    say(`作った行の ID：${file}`);
    return;
  }

  if (mode === "verify") {
    const ids = readIds();
    const before = JSON.parse(readFileSync(opt("--snap")!, "utf8"));
    const now = await snapshot(ids);
    const kale = opt("--kale") ? (JSON.parse(readFileSync(opt("--kale")!, "utf8")) as Kale) : null;
    const diff = TABLES.filter((t) => before.counts[t] !== now.counts[t]).map((t) => `${t}:${before.counts[t]}→${now.counts[t]}`);
    say(`件数の違い：${diff.join(" ") || "なし"}`);
    say(`トマトのデモの出品（${now.demoSupplies.length}件）：${JSON.stringify(before.demoSupplies) === JSON.stringify(now.demoSupplies) ? "前と同じ（数量・価格・公開・版・更新日時）" : "違う！"}`);
    const newItems = now.items.filter((i: any) => !before.items.some((b: any) => b.id === i.id));
    const goneItems = before.items.filter((b: any) => !now.items.some((i: any) => i.id === b.id));
    const newVars = now.varieties.filter((v: any) => !before.varieties.some((b: any) => b.id === v.id));
    say(`品目：増えた ${newItems.map((i: any) => i.name).join("・") || "なし"}・消えた ${goneItems.map((i: any) => i.name).join("・") || "なし"}／品種：増えた ${newVars.length}件`);
    if (kale) {
      const s = await prisma.supply.findUnique({ where: { id: kale.supplyId }, select: { availableKg: true, priceYenPerKg: true, published: true, originPrefecture: true, grade: true, producer: { select: { farmName: true } }, item: { select: { name: true } }, variety: { select: { name: true } }, slot: { select: { startAt: true, endAt: true, place: { select: { name: true } } } } } });
      say(`ケールの出品：${s ? `${s.producer.farmName}・${s.item.name}（${s.variety.name}）${s.availableKg}kg ¥${s.priceYenPerKg}/kg・${s.originPrefecture}・${s.grade}・${s.published ? "公開" : "非公開"}・${s.slot.startAt.toISOString()}〜${s.slot.endAt.toISOString()} ${s.slot.place.name}` : "なし"}`);
    }
    return;
  }

  const kale = JSON.parse(readFileSync(opt("--kale")!, "utf8")) as Kale;
  if (kale.endpoint !== ALLOWED) throw new Guard("kale.json の接続先が違うため中止");
  // デモの飲食店・生産者を確かめるため、3農家デモの ID の記録も読む（名前では探さない）
  if (!opt("--ids")) throw new Guard("--ids <デモの ids.json> が必要（デモの飲食店・生産者を ID で確かめるため）");
  const ids = JSON.parse(readFileSync(opt("--ids")!, "utf8")) as { endpoint: string; userIds: string[]; producerIds: string[]; restaurantUserId: string | null };
  if (ids.endpoint !== ALLOWED) throw new Guard("ids.json の接続先が違うため中止");
  if (!ids.producerIds.includes(kale.producerId)) throw new Guard("kale.json の出品者がデモの生産者ではないため中止");

  /** 後から追加した表（trade_reviews・usual_producers）は、マイグレーション前の DB には無い。無ければ 0 件として扱う */
  const hasTable = async (tx: any, table: string) => ((await tx.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1) AS ok`, table)) as { ok: boolean }[])[0]?.ok === true;

  /** 消す対象（記録した ID から辿れるものだけ）と、想定外の関連（本物の利用者のデータなど）を数える（読み取り） */
  const survey = async (tx: any) => {
    const supply = await tx.supply.findUnique({ where: { id: kale.supplyId }, select: { id: true, producerId: true, itemId: true, varietyId: true } });
    if (supply && (supply.producerId !== kale.producerId || supply.itemId !== kale.itemId || supply.varietyId !== kale.varietyId)) throw new Guard("ケールの出品の中身が記録と違うため中止");
    const approvals = await tx.approvalRequest.findMany({ where: { supplyId: kale.supplyId }, select: { id: true, restaurantId: true, producerId: true, planFingerprint: true, status: true, receivedAt: true } });
    // 同じ仕入れ案（相談）に、ケール以外の出品が入っていないか
    let otherSuppliesInPlan = 0;
    for (const key of new Set(approvals.map((a: any) => `${a.restaurantId}\u0000${a.planFingerprint}`))) {
      const [restaurantId, planFingerprint] = String(key).split("\u0000");
      otherSuppliesInPlan += await tx.approvalRequest.count({ where: { restaurantId, planFingerprint, supplyId: { not: kale.supplyId } } });
    }
    const messages = await tx.tradeMessage.findMany({ where: { approvalRequestId: { in: approvals.map((a: any) => a.id) } }, select: { id: true, senderUserId: true } });
    const approvalIds = approvals.map((a: any) => a.id);
    const reviews = await hasTable(tx, "trade_reviews") ? await tx.tradeReview.findMany({ where: { approvalRequestId: { in: approvalIds } }, select: { id: true, reviewerUserId: true } }) : [];
    const usuals = await hasTable(tx, "usual_producers") ? await tx.usualProducer.findMany({ where: { approvalRequestId: { in: approvalIds } }, select: { restaurantUserId: true, producerId: true } }) : [];
    const demoUsers = new Set(ids.userIds);
    const real = {
      approvals: approvals.filter((a: any) => a.restaurantId !== ids.restaurantUserId || a.producerId !== kale.producerId).length, // デモの店とデモ A農園のあいだの相談だけを消す
      otherSuppliesInPlan,
      messages: messages.filter((m: any) => !demoUsers.has(m.senderUserId)).length, // 送り手はデモの利用者だけのはず
      reviews: reviews.filter((v: any) => !demoUsers.has(v.reviewerUserId)).length, // 評価した人もデモの利用者だけのはず
      usuals: usuals.filter((u: any) => u.restaurantUserId !== ids.restaurantUserId || u.producerId !== kale.producerId).length, // デモの店がデモ A農園を登録したものだけ
    };
    const itemUse = kale.createdItem
      ? {
        otherSupplies: await tx.supply.count({ where: { itemId: kale.itemId, id: { not: kale.supplyId } } }),
        producerItems: await tx.producerItem.count({ where: { itemId: kale.itemId } }),
        varieties: await tx.variety.count({ where: { itemId: kale.itemId } }),
        otherVarietySupplies: await tx.supply.count({ where: { varietyId: kale.varietyId, id: { not: kale.supplyId } } }),
      }
      : null;
    return { supply, approvals, messages, reviews, usuals, real, itemUse };
  };

  if (mode === "inspect") {
    const r = await survey(prisma);
    say(`ケールの出品：${r.supply ? "あり" : "なし（すでに消えている）"}`);
    say(`相談：${r.approvals.length}件（${r.approvals.map((a: any) => `${a.status}${a.receivedAt ? "・受け取り完了" : ""}`).join("、") || "なし"}）・やり取り：${r.messages.length}件・評価：${r.reviews.length}件・いつもの農家：${r.usuals.length}件`);
    say(`想定外の関連：${JSON.stringify(r.real)}`);
    say(`品目「ケール」：${kale.createdItem ? `このスクリプトが作成・${JSON.stringify(r.itemUse)}` : "既存（消さない）"}`);
    return;
  }

  // delete：いつもの農家・評価・やり取り → 相談 → 出品 → 品種 → 品目 の順に、1 トランザクションで（相談への外部キーは RESTRICT）
  const out = await prisma.$transaction(async (tx: any) => {
    const r = await survey(tx);
    const realTotal = Object.values(r.real).reduce((a: number, b: number) => a + b, 0);
    if (realTotal > 0) throw new Guard(`想定外の関連データがあるため、何も消さない：${JSON.stringify(r.real)}`);
    const n = { usuals: 0, reviews: 0, tradeMessages: 0, approvals: 0, supplies: 0, varieties: 0, items: 0 };
    if (r.usuals.length) n.usuals = (await tx.usualProducer.deleteMany({ where: { approvalRequestId: { in: r.approvals.map((a: any) => a.id) }, OR: r.usuals.map((u: any) => ({ restaurantUserId: u.restaurantUserId, producerId: u.producerId })) } })).count;
    if (r.reviews.length) n.reviews = (await tx.tradeReview.deleteMany({ where: { id: { in: r.reviews.map((v: any) => v.id) } } })).count;
    n.tradeMessages = (await tx.tradeMessage.deleteMany({ where: { id: { in: r.messages.map((m: any) => m.id) } } })).count;
    n.approvals = (await tx.approvalRequest.deleteMany({ where: { id: { in: r.approvals.map((a: any) => a.id) } } })).count;
    if (r.supply) n.supplies = (await tx.supply.deleteMany({ where: { id: kale.supplyId } })).count;
    if (r.itemUse) {
      const u = r.itemUse;
      if (u.otherSupplies === 0 && u.otherVarietySupplies === 0 && u.producerItems === 0 && u.varieties <= 1) {
        n.varieties = (await tx.variety.deleteMany({ where: { id: kale.varietyId, itemId: kale.itemId } })).count;
        n.items = (await tx.item.deleteMany({ where: { id: kale.itemId } })).count;
      } else say(`品目「ケール」・品種はほかから使われているため残す：${JSON.stringify(u)}`);
    }
    if (n.usuals !== r.usuals.length || n.reviews !== r.reviews.length || n.tradeMessages !== r.messages.length || n.approvals !== r.approvals.length || n.supplies !== (r.supply ? 1 : 0)) {
      throw new Guard(`削除件数が想定と違うため取り消した：${JSON.stringify(n)}`);
    }
    return n;
  }, { timeout: 60_000, maxWait: 20_000 });
  say(`削除しました：${JSON.stringify(out)}`);
}

try {
  await main();
} catch (e) {
  if (e instanceof Guard) { console.error(`中止：${e.message}`); process.exitCode = 1; }
  else { console.error(`失敗：${(e as Error).name}（何も変更していないか、トランザクションで取り消されています）`); process.exitCode = 1; }
} finally {
  await prisma?.$disconnect();
}
