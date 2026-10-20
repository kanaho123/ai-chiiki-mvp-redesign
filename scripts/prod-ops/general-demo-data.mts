// 一般向けの DB（--target dev|production）に「3農家から仕入れて、受け取りは1か所」を見せるための架空のデモデータを入れる／消す。
// 運用用のツール（アプリの本体・Vercel の Functions からは使わない）。どのコマンドにも --target dev か --target production を付ける。
// ID・ログイン情報の記録はリポジトリの外（既定は ~/.ai-chiiki-ops/demo-data）に保存する。手順は scripts/prod-ops/README.md。
// すべての名前に「デモ」「（架空）」を付ける。実在の農家・店舗・住所・電話番号は使わない。既存の行は変更しない（新規追加だけ）。
//
// 使い方（リポジトリ直下で。接続情報は ENV_FILE だけから読む・表示しない）：
//   npx tsx scripts/prod-ops/general-demo-data.mts plan [--with-restaurant]           … 入れる内容を表示するだけ（DB に接続しない）
//   npx tsx scripts/prod-ops/general-demo-data.mts insert --confirm <CONFIRM_INSERT> [--with-restaurant]
//       … 1 トランザクションで追加し、作った全レコードの ID を <記録の保存先>/<日時>.ids.json に保存する
//         --with-restaurant：確認用の飲食店「デモ 食堂（架空）」も作る（ログイン用のパスワードは <記録の保存先>/<日時>.restaurant-login.local に保存。表示しない）
//   npx tsx scripts/prod-ops/general-demo-data.mts inspect --ids <ids.json>          … 読み取りのみ。デモの行と、本物の利用者のデータがデモの行を参照していないかを数える
//   npx tsx scripts/prod-ops/general-demo-data.mts delete --ids <ids.json> --confirm <CONFIRM_DELETE>
//       … デモの行（作った行と、アプリが自動で作った回・参加）だけを 1 トランザクションで消す。本物の利用者のデータが参照していたら何も消さない
//
// デモの構成：2026-10-27（火）トマト。A 5kg・B 3kg・C 2kg が同じ直売所（A の いつもの直売所）・同じ 9:00〜11:00。D 4kg は D の農園・13:00〜15:00。
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

// ── 接続先（--target dev か --target production で選ぶ。指定がなければ動かない） ──
// 接続情報（DATABASE_URL など）は、リポジトリ直下の ENV_FILE（Git 対象外）からだけ読む。ここには書かない
const TARGETS = {
  production: {
    ALLOWED: "ep-bitter-credit-b8fbhoir", ENV_FILE: ".env.general.production.local", ENDPOINT_KEY: "GENERAL_PROD_DB_ENDPOINT",
    CONFIRM_INSERT: "GENERAL_PRODUCTION_DEMO_DATA_INSERT", CONFIRM_DELETE: "GENERAL_PRODUCTION_DEMO_DATA_DELETE", LABEL: "一般向け Production DB",
  },
  dev: {
    ALLOWED: "ep-polished-surf-b82ja29g", ENV_FILE: ".env.general.local", ENDPOINT_KEY: "GENERAL_DB_ENDPOINT",
    CONFIRM_INSERT: "GENERAL_DEV_DEMO_DATA_INSERT", CONFIRM_DELETE: "GENERAL_DEV_DEMO_DATA_DELETE", LABEL: "一般向け dev DB",
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

const DAY = "2026-10-27";
const SLOT_X = { start: "2026-10-27T00:00:00.000Z", end: "2026-10-27T02:00:00.000Z", deadline: "2026-10-26T07:00:00.000Z", weekday: 2, startTime: "09:00", endTime: "11:00" }; // 火 9:00〜11:00 JST、締切は 17 時間前
const SLOT_Y = { start: "2026-10-27T04:00:00.000Z", end: "2026-10-27T06:00:00.000Z", deadline: "2026-10-26T11:00:00.000Z", weekday: 2, startTime: "13:00", endTime: "15:00" }; // 火 13:00〜15:00 JST
const PLACE_X = { name: "デモ みどり坂ふれあい直売所（架空）", kind: "direct_store" };
const PLACE_Y = { name: "デモ D農園の作業場（架空）", kind: "farm" };
const ADDRESS = "デモ用の架空の住所（実在しません）";
const FARMS = [
  { key: "A", kg: 5, price: 600, place: "X", phone: "000-0000-9901" },
  { key: "B", kg: 3, price: 550, place: "X", phone: "000-0000-9902" },
  { key: "C", kg: 2, price: 500, place: "X", phone: "000-0000-9903" },
  { key: "D", kg: 4, price: 450, place: "Y", phone: "000-0000-9904" },
] as const;
const farmName = (k: string) => `デモ ${k}農園（架空）`;
const SHOP = "デモ 食堂（架空）";

class Guard extends Error {}
const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const withRestaurant = args.includes("--with-restaurant");
const say = (s: string) => console.log(s);
let prisma: any = null;

function planText() {
  say(`デモの日：${DAY}（火）・品目：トマト（指定なし）・産地：大阪府`);
  say(`場所 X：${PLACE_X.name}（種類：直売所・持ち主：${farmName("A")}・住所：${ADDRESS}）`);
  say(`  毎週の回：火 ${SLOT_X.startTime}〜${SLOT_X.endTime}・受け渡し費用 0円・参加：${farmName("A")}・${farmName("B")}・${farmName("C")}`);
  say(`場所 Y：${PLACE_Y.name}（種類：自分の農園・持ち主：${farmName("D")}・住所：${ADDRESS}）`);
  say(`  毎週の回：火 ${SLOT_Y.startTime}〜${SLOT_Y.endTime}・受け渡し費用 0円・参加：${farmName("D")}`);
  for (const f of FARMS) say(`出品：${farmName(f.key)} トマト ${f.kg}kg ¥${f.price}/kg・公開・${DAY} ${f.place === "X" ? `${SLOT_X.startTime}〜${SLOT_X.endTime} 場所 X` : `${SLOT_Y.startTime}〜${SLOT_Y.endTime} 場所 Y`}・連絡先 ${f.phone}（架空）`);
  say(`生産者のアカウント：メールは demo-farm-<a〜d>-<日時>@example.invalid、パスワードなし（ログインできない）`);
  if (withRestaurant) say(`確認用の飲食店：${SHOP}（居酒屋・大阪府大阪市北区）。メール demo-rest-<日時>@example.invalid、パスワードはランダム（ファイルに保存し、表示しない）`);
}

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

type Ids = {
  stamp: string; endpoint: string; userIds: string[]; producerIds: string[]; restaurantUserId: string | null; restaurantId: string | null;
  placeIds: string[]; seriesIds: string[]; slotIds: string[]; supplyIds: string[]; emails: string[];
};

/** デモの行と、それを参照している行を数える（読み取り） */
async function survey(tx: any, ids: Ids) {
  const demoProducers = ids.producerIds;
  const demoUsers = ids.userIds;
  const slots = await tx.handoverSlot.findMany({ where: { OR: [{ seriesId: { in: ids.seriesIds } }, { placeId: { in: ids.placeIds } }] }, select: { id: true, seriesId: true } });
  const slotIds = slots.map((s: any) => s.id);
  const supplies = await tx.supply.findMany({ where: { OR: [{ producerId: { in: demoProducers } }, { slotId: { in: slotIds } }] }, select: { id: true, producerId: true } });
  const supplyIds = supplies.map((s: any) => s.id);
  const approvals = await tx.approvalRequest.findMany({ where: { OR: [{ supplyId: { in: supplyIds } }, { producerId: { in: demoProducers } }, ...(ids.restaurantUserId ? [{ restaurantId: ids.restaurantUserId }] : [])] }, select: { id: true, restaurantId: true, producerId: true } });
  const relationships = await tx.relationship.findMany({ where: { OR: [{ producerId: { in: demoProducers } }, ...(ids.restaurantUserId ? [{ restaurantUserId: ids.restaurantUserId }] : [])] }, select: { restaurantUserId: true, producerId: true } });
  const seriesParticipants = await tx.slotSeriesParticipant.findMany({ where: { OR: [{ seriesId: { in: ids.seriesIds } }, { producerId: { in: demoProducers } }] }, select: { seriesId: true, producerId: true } });
  const slotParticipants = await tx.slotParticipant.findMany({ where: { OR: [{ slotId: { in: slotIds } }, { producerId: { in: demoProducers } }] }, select: { slotId: true, producerId: true } });
  const seriesAtPlaces = await tx.slotSeries.findMany({ where: { placeId: { in: ids.placeIds } }, select: { id: true } });
  const isDemoP = (p: string) => demoProducers.includes(p);
  const isDemoU = (u: string) => demoUsers.includes(u);
  const real = {
    supplies: supplies.filter((s: any) => !isDemoP(s.producerId)).length, // 本物の生産者がデモの回に出品
    approvals: approvals.filter((a: any) => !isDemoU(a.restaurantId) || !isDemoP(a.producerId)).length, // 本物の飲食店からの相談など
    relationships: relationships.filter((r: any) => !isDemoU(r.restaurantUserId) || !isDemoP(r.producerId)).length,
    seriesParticipants: seriesParticipants.filter((s: any) => !isDemoP(s.producerId)).length, // 本物の生産者がデモの場所の回に参加
    slotParticipants: slotParticipants.filter((s: any) => !isDemoP(s.producerId)).length,
    otherSeriesAtDemoPlaces: seriesAtPlaces.filter((s: any) => !ids.seriesIds.includes(s.id)).length, // 本物の生産者がデモの場所に別の時間を登録
  };
  const throttles = await tx.authThrottle.findMany({ select: { key: true } });
  const throttleKeys = throttles.map((t: any) => t.key).filter((k: string) => ids.emails.some((e) => k.includes(e)));
  return { slotIds, supplyIds, approvals, relationships, seriesParticipants, slotParticipants, real, throttleKeys };
}

async function main() {
  if (!["plan", "insert", "inspect", "delete"].includes(mode)) throw new Guard("モードは plan / insert / inspect / delete のどれか");
  if (mode === "plan") { planText(); return; }
  if (mode === "insert" && opt("--confirm") !== CONFIRM_INSERT) throw new Guard(`追加には --confirm ${CONFIRM_INSERT} が必要`);
  if (mode === "delete" && opt("--confirm") !== CONFIRM_DELETE) throw new Guard(`削除には --confirm ${CONFIRM_DELETE} が必要`);
  if ((mode === "inspect" || mode === "delete") && !opt("--ids")) throw new Guard("--ids <ids.json> が必要");
  await connect();

  if (mode === "insert") {
    if (Date.now() >= Date.parse(SLOT_X.deadline)) throw new Guard("デモの回の確認締切を過ぎているため中止");
    const { hashPassword } = await import(pathToFileURL(resolve(process.cwd(), "server/auth.ts")).href);
    const { PRIVACY_VERSION, TERMS_VERSION } = await import(pathToFileURL(resolve(process.cwd(), "src/lib/legal.ts")).href);
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const password = withRestaurant ? randomBytes(18).toString("base64url") : null;
    const passwordHash = password ? await hashPassword(password) : null;
    planText();
    const ids: Ids = await prisma.$transaction(async (tx: any) => {
      const exists = await tx.producer.count({ where: { farmName: { startsWith: "デモ ", endsWith: "（架空）" } } });
      if (exists) throw new Guard(`デモの生産者がすでに ${exists} 件ある（二重に入れない）`);
      const tomato = await tx.item.findUnique({ where: { name: "トマト" }, select: { id: true, varieties: { where: { name: "指定なし" }, select: { id: true } } } });
      if (!tomato || tomato.varieties.length !== 1) throw new Guard("品目「トマト（指定なし）」がない");
      const now = new Date();
      const lid = () => `u-${randomBytes(24).toString("base64url")}`;
      const out: Ids = { stamp, endpoint: ALLOWED, userIds: [], producerIds: [], restaurantUserId: null, restaurantId: null, placeIds: [], seriesIds: [], slotIds: [], supplyIds: [], emails: [] };
      const producers: Record<string, string> = {};
      for (const f of FARMS) {
        const email = `demo-farm-${f.key.toLowerCase()}-${stamp}@example.invalid`;
        const u = await tx.user.create({ data: { email, loginId: lid(), passwordHash: null, role: "producer", displayName: farmName(f.key), onboardedAt: now, legalAcceptedAt: now, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } });
        const p = await tx.producer.create({ data: { ownerUserId: u.id, farmName: farmName(f.key), producerName: "デモ 生産者（架空）", originPrefecture: "大阪府", city: "架空市", contactPhone: f.phone, contactEmail: null } });
        await tx.producerItem.create({ data: { producerId: p.id, itemId: tomato.id } });
        out.userIds.push(u.id); out.producerIds.push(p.id); out.emails.push(email); producers[f.key] = p.id;
      }
      const placeX = await tx.place.create({ data: { name: PLACE_X.name, address: ADDRESS, kind: PLACE_X.kind, ownerProducerId: producers.A } });
      const placeY = await tx.place.create({ data: { name: PLACE_Y.name, address: ADDRESS, kind: PLACE_Y.kind, ownerProducerId: producers.D } });
      out.placeIds.push(placeX.id, placeY.id);
      const mkSeries = (placeId: string, s: typeof SLOT_X) => tx.slotSeries.create({ data: { placeId, label: `毎週火 ${s.startTime}〜${s.endTime}`, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, deadlineHours: 17, feeYen: 0, maxKg: 100, active: true } });
      const seriesX = await mkSeries(placeX.id, SLOT_X), seriesY = await mkSeries(placeY.id, SLOT_Y);
      out.seriesIds.push(seriesX.id, seriesY.id);
      const mkSlot = (placeId: string, seriesId: string, name: string, s: typeof SLOT_X) => tx.handoverSlot.create({ data: { placeId, seriesId, label: `${name}・火${s.startTime}`, startAt: new Date(s.start), endAt: new Date(s.end), confirmDeadlineAt: new Date(s.deadline), feeYen: 0, feeConfirmed: true, maxKg: 100, conditionsConfirmed: true } });
      const slotX = await mkSlot(placeX.id, seriesX.id, PLACE_X.name, SLOT_X), slotY = await mkSlot(placeY.id, seriesY.id, PLACE_Y.name, SLOT_Y);
      out.slotIds.push(slotX.id, slotY.id);
      for (const f of FARMS) {
        const seriesId = f.place === "X" ? seriesX.id : seriesY.id;
        const slotId = f.place === "X" ? slotX.id : slotY.id;
        await tx.slotSeriesParticipant.create({ data: { seriesId, producerId: producers[f.key] } });
        await tx.slotParticipant.create({ data: { slotId, producerId: producers[f.key], confirmed: true } });
        const s = await tx.supply.create({ data: { producerId: producers[f.key], itemId: tomato.id, varietyId: tomato.varieties[0].id, grade: "regular", originPrefecture: "大阪府", availableKg: f.kg, priceYenPerKg: f.price, minKg: 1, slotId, published: true } });
        out.supplyIds.push(s.id);
      }
      if (withRestaurant) {
        const email = `demo-rest-${stamp}@example.invalid`;
        const u = await tx.user.create({ data: { email, loginId: lid(), passwordHash, role: "restaurant", displayName: SHOP, onboardedAt: now, legalAcceptedAt: now, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION } });
        const r = await tx.restaurant.create({ data: { ownerUserId: u.id, name: SHOP, businessType: "izakaya", prefecture: "大阪府", city: "大阪市北区" } });
        out.userIds.push(u.id); out.emails.push(email); out.restaurantUserId = u.id; out.restaurantId = r.id;
      }
      return out;
    }, { timeout: 60_000, maxWait: 20_000 });
    mkdirSync(OUT_DIR, { recursive: true });
    const idsFile = resolve(OUT_DIR, `${stamp}.ids.json`);
    writeFileSync(idsFile, JSON.stringify(ids, null, 1), { flag: "wx" });
    say(`追加しました。作った全レコードの ID：${idsFile}`);
    say(`  ユーザー ${ids.userIds.length}・生産者 ${ids.producerIds.length}・場所 ${ids.placeIds.length}・毎週の回 ${ids.seriesIds.length}・受け渡しの回 ${ids.slotIds.length}・出品 ${ids.supplyIds.length}・飲食店 ${ids.restaurantId ? 1 : 0}`);
    if (password) {
      const loginFile = resolve(OUT_DIR, `${stamp}.restaurant-login.local`);
      writeFileSync(loginFile, JSON.stringify({ email: ids.emails.at(-1), password }), { flag: "wx", mode: 0o600 });
      say(`確認用の飲食店のログイン情報（パスワードは表示しない）：${loginFile}`);
    }
    return;
  }

  const ids: Ids = JSON.parse(readFileSync(resolve(opt("--ids")!), "utf8"));
  if (ids.endpoint !== ALLOWED) throw new Guard("ids ファイルの接続先が違うため中止");
  if (mode === "inspect") {
    const s = await prisma.$transaction(async (tx: any) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return survey(tx, ids); }, { timeout: 60_000, maxWait: 20_000 });
    say(`デモの受け渡しの回 ${s.slotIds.length}・出品 ${s.supplyIds.length}・相談 ${s.approvals.length}・取引の関係 ${s.relationships.length}・毎週の回の参加 ${s.seriesParticipants.length}・回の参加 ${s.slotParticipants.length}・ログイン制限の記録 ${s.throttleKeys.length}`);
    say(`本物の利用者のデータがデモを参照している件数：${JSON.stringify(s.real)}`);
    return;
  }

  // delete
  const result = await prisma.$transaction(async (tx: any) => {
    const s = await survey(tx, ids);
    const realTotal = Object.values(s.real).reduce((a: number, b: any) => a + b, 0);
    if (realTotal > 0) throw new Guard(`本物の利用者のデータがデモの行を参照しているため、何も消さない：${JSON.stringify(s.real)}`);
    const n: Record<string, number> = {};
    // 取引のやり取り（デモの相談に紐づくもの）を先に消す（相談への外部キーがあるため）。送り手がデモの利用者でなければ何も消さない
    const msgs = await tx.tradeMessage.findMany({ where: { approvalRequestId: { in: s.approvals.map((a: any) => a.id) } }, select: { id: true, senderUserId: true } });
    if (msgs.some((m: any) => !ids.userIds.includes(m.senderUserId))) throw new Guard("デモの相談に、デモの利用者以外のやり取りがあるため、何も消さない");
    n.tradeMessages = (await tx.tradeMessage.deleteMany({ where: { id: { in: msgs.map((m: any) => m.id) } } })).count;
    n.approvals = (await tx.approvalRequest.deleteMany({ where: { id: { in: s.approvals.map((a: any) => a.id) } } })).count;
    n.relationships = (await tx.relationship.deleteMany({ where: { producerId: { in: ids.producerIds } } })).count;
    n.supplies = (await tx.supply.deleteMany({ where: { id: { in: s.supplyIds } } })).count;
    n.slotParticipants = (await tx.slotParticipant.deleteMany({ where: { OR: [{ slotId: { in: s.slotIds } }, { producerId: { in: ids.producerIds } }] } })).count;
    n.slots = (await tx.handoverSlot.deleteMany({ where: { id: { in: s.slotIds } } })).count;
    n.seriesParticipants = (await tx.slotSeriesParticipant.deleteMany({ where: { OR: [{ seriesId: { in: ids.seriesIds } }, { producerId: { in: ids.producerIds } }] } })).count;
    n.series = (await tx.slotSeries.deleteMany({ where: { id: { in: ids.seriesIds } } })).count;
    n.producerItems = (await tx.producerItem.deleteMany({ where: { producerId: { in: ids.producerIds } } })).count;
    n.places = (await tx.place.deleteMany({ where: { id: { in: ids.placeIds } } })).count;
    n.producers = (await tx.producer.deleteMany({ where: { id: { in: ids.producerIds } } })).count;
    n.restaurants = ids.restaurantId ? (await tx.restaurant.deleteMany({ where: { id: ids.restaurantId } })).count : 0;
    n.users = (await tx.user.deleteMany({ where: { id: { in: ids.userIds }, email: { endsWith: "@example.invalid" } } })).count;
    n.throttles = s.throttleKeys.length ? (await tx.authThrottle.deleteMany({ where: { key: { in: s.throttleKeys } } })).count : 0;
    if (n.producers !== ids.producerIds.length || n.places !== ids.placeIds.length || n.series !== ids.seriesIds.length || n.users !== ids.userIds.length || n.restaurants !== (ids.restaurantId ? 1 : 0))
      throw new Guard(`削除件数が想定と違うため取り消した：${JSON.stringify(n)}`);
    return n;
  }, { timeout: 60_000, maxWait: 20_000 });
  say(`削除しました：${JSON.stringify(result)}`);
}

try {
  await main();
} catch (e: any) {
  say(`中止：${e instanceof Guard ? e.message : `${e?.name ?? "Error"} ${e?.code ?? ""}`.trim()}`);
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect().catch(() => {});
  if (existsSync(OUT_DIR)) {
    const left = (await import("node:fs")).readdirSync(OUT_DIR).filter((f: string) => f.endsWith(".restaurant-login.local"));
    say(`Restaurant login file remains: ${left.length ? `YES（${left.join(", ")}）` : "NO"}`);
  }
}
