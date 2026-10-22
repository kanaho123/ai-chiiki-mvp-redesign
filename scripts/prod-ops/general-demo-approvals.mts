// 一般向けの DB（--target dev|production）で、デモの店（デモ 食堂（架空））からデモの農家（デモ A〜D農園（架空））へ送った
// 相談（ApprovalRequest）を確かめる／消す／相談前の状態に戻す（reset）／reset の前に戻す（restore）運用ツール（アプリの本体・Vercel の Functions からは使わない）。
// 例：デモの前に、以前の確認で送ったトマト10kg の相談が残っていて「仕入れ相談する」が出ないとき（2026-10-20 に本番で使用）。
//
// 使い方（リポジトリ直下で。接続情報は ENV_FILE だけから読む・表示しない。ID の記録・バックアップは AIC_OPS_DATA_DIR（既定 ~/.ai-chiiki-ops/demo-data））：
//   npx tsx scripts/prod-ops/general-demo-approvals.mts inspect --target production --ids <data>/<日時>.ids.json [--kale <data>/<日時>.kale.json]
//       … 読み取りのみ。デモの店の相談を仕入れ案ごとに一覧にし、delete・reset できるかと ID を示す
//   npx tsx scripts/prod-ops/general-demo-approvals.mts delete --target production --ids <ids.json> [--kale <kale.json>] --expect-ids <id1,id2,...> --confirm <CONFIRM_DELETE> [--allow-approved]
//       … 指定した ID の相談だけを 1 トランザクションで消す。出品・品目・生産者・店・場所・回は変えない
//   npx tsx scripts/prod-ops/general-demo-approvals.mts reset --target production --ids <ids.json> [--kale <kale.json>] --expect-ids <id1,id2,...> --confirm <CONFIRM_RESET> [--include-completed]
//       … 指定した仕入れ案の相談（状態を問わない）と、そのやり取り（trade_messages）・取引の評価（trade_reviews）・その相談から登録した「いつもの農家」（usual_producers）を消し、
//         相談を送る前の状態に戻す。消す前に JSON にバックアップする
//   npx tsx scripts/prod-ops/general-demo-approvals.mts restore --target production --ids <ids.json> [--kale <kale.json>] --backup <data>/<日時>.approvals-reset.backup.json --confirm <CONFIRM_RESTORE>
//       … reset のバックアップから、相談・やり取り・評価・いつもの農家を元の ID・時刻・状態のまま入れ直す
//   --allow-approved：delete で「対応できます」（approved）と返事済みの相談も消してよいことにする（明示したときだけ。例：途中まで返事が来たデモの相談をデモ前に片付ける）。
//       inspect にも付けられる。ほかの条件（受け取り完了なし・やり取り0件・仕入れ案の全件を指定 など）は変わらない
//   --include-completed：reset で受け取り完了（receivedAt あり）の仕入れ案も対象にする（明示したときだけ）。inspect にも付けられる
//
// delete の条件（1件でも合わなければ何も消さない）：
//   ・指定した ID がすべて、デモの店（記録の ID）からデモの農家（記録の ID）への相談で、出品がデモの出品（記録の ID。--kale ならケールも）
//   ・状態が返事待ち（pending）（--allow-approved のときは「対応できます」（approved）も可）・受け取り完了なし（receivedAt が null）・やり取り（trade_messages）0件
//   ・同じ仕入れ案（店・planFingerprint）の相談をすべて指定している（仕入れ案の一部だけを消さない）
//   ・指定した ID がもう1件も無ければ、何もせずに終わる（2回目の実行で壊れない）
// reset の条件（1件でも合わなければ何も変えない）：
//   ・delete と同じ「デモの店・デモの農家・デモの出品」「仕入れ案の全件を指定」。状態（返事待ち・対応できます・今回は対応できません）は問わない
//   ・店と農家のユーザーが、記録にあるデモのユーザー（メールが @example.invalid）であること
//   ・やり取りの送り手・評価した人が、デモの店か、その相談のデモの農家のユーザーだけであること。いつもの農家は、デモの店がその相談の農家を登録したものだけであること
//   ・受け取り完了の相談は --include-completed のときだけ
//   ・消す前に対象の行をバックアップ（JSON）し、トランザクションの中でバックアップと今の行のハッシュが一致することを確かめる
//   ・トランザクションの中で、対象外のデータ（全テーブル。相談・やり取りは対象の ID を除く）のハッシュを消す前後で比べ、違えば取り消す
//   ・指定した ID がもう1件も無ければ、何もせずに終わる（2回目の実行で壊れない）
// restore の条件（1件でも合わなければ何も変えない）：
//   ・バックアップの接続先・店が今の --target・記録と一致し、ファイルのハッシュが合っていること
//   ・同じ ID の相談・やり取り・評価、同じ店・農家のいつもの農家がまだ無いこと。同じ店・出品・仕入れ案の相談が新しく送られていないこと
//   ・相談の出品がまだあり、その農家の出品であること。店・農家・送り手が reset のときと同じ条件を満たすこと
//   ・入れ直した行のハッシュがバックアップと一致し、対象外のデータが前後で変わっていないこと
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── 接続先（--target dev か --target production で選ぶ。指定がなければ動かない） ──
// 接続情報（DATABASE_URL など）は、リポジトリ直下の ENV_FILE（Git 対象外）からだけ読む。ここには書かない
const TARGETS = {
  production: {
    ALLOWED: "ep-bitter-credit-b8fbhoir", ENV_FILE: ".env.general.production.local", ENDPOINT_KEY: "GENERAL_PROD_DB_ENDPOINT", LABEL: "一般向け Production DB",
    CONFIRM_DELETE: "GENERAL_PRODUCTION_DEMO_APPROVALS_DELETE", CONFIRM_RESET: "GENERAL_PRODUCTION_DEMO_APPROVALS_RESET", CONFIRM_RESTORE: "GENERAL_PRODUCTION_DEMO_APPROVALS_RESTORE",
  },
  dev: {
    ALLOWED: "ep-polished-surf-b82ja29g", ENV_FILE: ".env.general.local", ENDPOINT_KEY: "GENERAL_DB_ENDPOINT", LABEL: "一般向け dev DB",
    CONFIRM_DELETE: "GENERAL_DEV_DEMO_APPROVALS_DELETE", CONFIRM_RESET: "GENERAL_DEV_DEMO_APPROVALS_RESET", CONFIRM_RESTORE: "GENERAL_DEV_DEMO_APPROVALS_RESTORE",
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
// ── ここまで ──

// バックアップの保存先：リポジトリの外（Git に入れない）。既定は ~/.ai-chiiki-ops/demo-data
const OUT_DIR = process.env.AIC_OPS_DATA_DIR ? resolve(process.env.AIC_OPS_DATA_DIR) : resolve(homedir(), ".ai-chiiki-ops", "demo-data");
const BACKUP_KIND = "general-demo-approvals-reset-backup";

class Guard extends Error {}
const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const allowApproved = args.includes("--allow-approved");
const includeCompleted = args.includes("--include-completed");
const allowedStatuses = allowApproved ? ["pending", "approved"] : ["pending"];
let prisma: any = null;
type Ids = { endpoint: string; userIds: string[]; producerIds: string[]; restaurantUserId: string | null; supplyIds: string[] };
// reviews・usuals は後から追加した表（2026-10-23）。それより前のバックアップには無い（空として扱う）
type Target = { approvals: any[]; messages: any[]; reviews?: any[]; usuals?: any[] };

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

/** キーの順番・日時の形に左右されないハッシュ（バックアップの JSON と DB から読んだ行を同じ値にする） */
const stable = (v: unknown): unknown =>
  v instanceof Date ? v.toISOString()
  : Array.isArray(v) ? v.map(stable)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
  : v;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex");
const byKey = (k: (x: any) => string) => (a: any, b: any) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0);
const usualKey = (u: any) => `${u.restaurantUserId}|${u.producerId}`;
/** 評価・いつもの農家が無いときは、以前と同じ値になる（以前のバックアップもそのまま確かめられる） */
const targetHash = (t: Target) => sha({
  approvals: [...t.approvals].sort((a, b) => (a.id < b.id ? -1 : 1)), messages: [...t.messages].sort((a, b) => (a.id < b.id ? -1 : 1)),
  ...(t.reviews?.length ? { reviews: [...t.reviews].sort(byKey((r) => r.id)) } : {}),
  ...(t.usuals?.length ? { usuals: [...t.usuals].sort(byKey(usualKey)) } : {}),
});

/** 後から追加した表（trade_reviews・usual_producers）は、マイグレーション前の DB には無い。無ければ 0 件として扱う */
const hasTable = async (db: any, table: string) => ((await db.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1) AS ok`, table)) as { ok: boolean }[])[0]?.ok === true;

/** 指定した相談と、それに紐づくやり取り・評価・いつもの農家（読み取り） */
async function loadTarget(db: any, approvalIds: string[]): Promise<Target> {
  const approvals = await db.approvalRequest.findMany({ where: { id: { in: approvalIds } }, orderBy: { id: "asc" } });
  const messages = await db.tradeMessage.findMany({ where: { approvalRequestId: { in: approvalIds } }, orderBy: { id: "asc" } });
  const reviews = await hasTable(db, "trade_reviews") ? await db.tradeReview.findMany({ where: { approvalRequestId: { in: approvalIds } }, orderBy: { id: "asc" } }) : [];
  const usuals = await hasTable(db, "usual_producers") ? await db.usualProducer.findMany({ where: { approvalRequestId: { in: approvalIds } }, orderBy: [{ restaurantUserId: "asc" }, { producerId: "asc" }] }) : [];
  return { approvals, messages, reviews, usuals };
}

/**
 * 対象外のデータの指紋（全テーブルの件数と、全列の内容のハッシュ）。相談・やり取りは対象の ID、評価・いつもの農家は対象の相談に結びつくものを除く。
 * 同じトランザクションの中で消す前後に取り、対象の行以外が変わっていないことを確かめる
 */
async function otherDataHash(tx: any, approvalIds: string[], messageIds: string[]) {
  const tables: { t: string }[] = await tx.$queryRawUnsafe(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`);
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const [column, exclude] = t === "approval_requests" ? ["id", approvalIds] : t === "trade_messages" ? ["id", messageIds]
      : t === "trade_reviews" || t === "usual_producers" ? ["approvalRequestId", approvalIds] : [null, null];
    const rows: { n: number; h: string | null }[] = await tx.$queryRawUnsafe(
      `SELECT count(*)::int AS n, md5(string_agg(x::text, '|' ORDER BY x::text)) AS h FROM "${t.replace(/"/g, '""')}" x${exclude ? ` WHERE x."${column}" <> ALL($1::text[])` : ""}`,
      ...(exclude ? [exclude] : []));
    out[t] = `${rows[0].n}:${rows[0].h ?? ""}`;
  }
  return out;
}
const diffTables = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);

async function main() {
  if (!["inspect", "delete", "reset", "restore"].includes(mode)) throw new Guard("モードは inspect / delete / reset / restore");
  if (!opt("--ids")) throw new Guard("--ids <デモの ids.json> が必要（デモの店・農家・出品を ID で確かめるため）");
  const confirmWord = mode === "delete" ? T.CONFIRM_DELETE : mode === "reset" ? T.CONFIRM_RESET : mode === "restore" ? T.CONFIRM_RESTORE : null;
  if (confirmWord && opt("--confirm") !== confirmWord) throw new Guard(`${mode} には --confirm ${confirmWord} が必要`);
  if ((mode === "delete" || mode === "reset") && !opt("--expect-ids")) throw new Guard(`${mode} には --expect-ids <id1,id2,...> が必要（inspect で確かめた ID）`);
  if (mode === "restore" && !opt("--backup")) throw new Guard("restore には --backup <reset のバックアップ> が必要");
  const ids = readJson(opt("--ids")!) as Ids;
  if (ids.endpoint !== ALLOWED) throw new Guard("ids.json の接続先が違うため中止");
  if (!ids.restaurantUserId) throw new Guard("ids.json にデモの店がない");
  const shopId = ids.restaurantUserId;
  const kale = opt("--kale") ? readJson(opt("--kale")!) as { endpoint: string; supplyId: string } : null;
  if (kale && kale.endpoint !== ALLOWED) throw new Guard("kale.json の接続先が違うため中止");
  const demoSupplies = [...ids.supplyIds, ...(kale ? [kale.supplyId] : [])];
  const backupIn = mode === "restore" ? readJson(opt("--backup")!) : null;
  if (backupIn) {
    if (backupIn.kind !== BACKUP_KIND) throw new Guard("reset のバックアップではないため中止");
    if (backupIn.endpoint !== ALLOWED || backupIn.target !== targetName) throw new Guard("バックアップの接続先が --target と違うため中止");
    if (backupIn.restaurantUserId !== shopId) throw new Guard("バックアップの店がデモの記録と違うため中止");
    if (targetHash(backupIn) !== backupIn.hash) throw new Guard("バックアップの中身がハッシュと合わないため中止");
  }
  await connect();

  /** 1件ごとの条件（読み取り）：delete 用 */
  const rowProblems = async (tx: any, r: any) => {
    const p: string[] = [];
    if (r.restaurantId !== shopId) p.push("店がデモの店ではない");
    if (!ids.producerIds.includes(r.producerId)) p.push("生産者がデモの農家ではない");
    if (!demoSupplies.includes(r.supplyId)) p.push("出品がデモの出品ではない");
    if (!allowedStatuses.includes(r.status)) p.push(`${allowApproved ? "返事待ち・対応できます" : "返事待ち"}ではない（${r.status}）`);
    if (r.receivedAt !== null) p.push("受け取り完了あり");
    const messages = await tx.tradeMessage.count({ where: { approvalRequestId: r.id } });
    if (messages > 0) p.push(`やり取り ${messages}件`);
    const reviews = await hasTable(tx, "trade_reviews") ? await tx.tradeReview.count({ where: { approvalRequestId: r.id } }) : 0;
    if (reviews > 0) p.push(`取引の評価 ${reviews}件`);
    const usuals = await hasTable(tx, "usual_producers") ? await tx.usualProducer.count({ where: { approvalRequestId: r.id } }) : 0;
    if (usuals > 0) p.push(`いつもの農家 ${usuals}件`);
    return p;
  };

  /**
   * reset・restore の条件（読み取り）。相談は状態を問わない。店・農家のユーザー、やり取りの送り手もデモの記録で確かめる。
   * checkCompleted：受け取り完了を --include-completed なしで止める（restore では止めない）
   */
  const tradeProblems = async (db: any, t: Target, checkCompleted: boolean) => {
    const p: string[] = [];
    const producers = await db.producer.findMany({ where: { id: { in: [...new Set(t.approvals.map((r) => r.producerId))] } }, select: { id: true, ownerUserId: true } });
    const ownerOf = new Map<string, string>(producers.map((x: any) => [x.id, x.ownerUserId]));
    const userIds = [...new Set([shopId, ...ownerOf.values()])];
    const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } });
    for (const id of userIds) {
      const u = users.find((x: any) => x.id === id);
      if (!u || !ids.userIds.includes(id) || !u.email?.endsWith("@example.invalid")) p.push(`ユーザー ${id} がデモのユーザーではない`);
    }
    for (const r of t.approvals) {
      const q: string[] = [];
      if (r.restaurantId !== shopId) q.push("店がデモの店ではない");
      if (!ids.producerIds.includes(r.producerId) || !ownerOf.has(r.producerId)) q.push("生産者がデモの農家ではない");
      if (!demoSupplies.includes(r.supplyId)) q.push("出品がデモの出品ではない");
      if (checkCompleted && r.receivedAt && !includeCompleted) q.push("受け取り完了あり（--include-completed がない）");
      if (q.length) p.push(`${r.id}：${q.join("・")}`);
    }
    const rowOf = new Map<string, any>(t.approvals.map((r) => [r.id, r]));
    for (const m of t.messages) {
      const r = rowOf.get(m.approvalRequestId);
      if (!r || (m.senderUserId !== shopId && m.senderUserId !== ownerOf.get(r.producerId))) p.push(`やり取り ${m.id} の送り手がデモの店・その農家ではない`);
    }
    for (const v of t.reviews ?? []) {
      const r = rowOf.get(v.approvalRequestId);
      if (!r || (v.reviewerUserId !== shopId && v.reviewerUserId !== ownerOf.get(r.producerId))) p.push(`評価 ${v.id} の評価者がデモの店・その農家ではない`);
    }
    for (const u of t.usuals ?? []) {
      const r = rowOf.get(u.approvalRequestId);
      if (!r || u.restaurantUserId !== shopId || u.producerId !== r.producerId) p.push(`いつもの農家 ${usualKey(u)} がデモの店・その相談の農家のものではない`);
    }
    return p;
  };

  /** 仕入れ案（店・planFingerprint）の相談を、指定した ID で全件そろえているか */
  const missingInPlans = async (db: any, rows: any[], expected: string[]) => {
    const missing: string[] = [];
    for (const fp of new Set(rows.map((r) => r.planFingerprint))) {
      const all = await db.approvalRequest.findMany({ where: { restaurantId: shopId, planFingerprint: fp }, select: { id: true } });
      missing.push(...all.map((a: any) => a.id).filter((id: string) => !expected.includes(id)));
    }
    return missing;
  };

  const shop = await prisma.user.findUnique({ where: { id: shopId }, select: { displayName: true, email: true } });
  if (!shop || shop.displayName !== "デモ 食堂（架空）" || !shop.email?.endsWith("@example.invalid")) throw new Guard("デモの店が記録と違うため中止");

  if (mode === "inspect") {
    const rows = await prisma.approvalRequest.findMany({ where: { restaurantId: shopId }, orderBy: [{ planFingerprint: "asc" }, { id: "asc" }] });
    const producers = new Map((await prisma.producer.findMany({ where: { id: { in: ids.producerIds } }, select: { id: true, farmName: true } })).map((p: any) => [p.id, p.farmName]));
    const toDemo = await prisma.approvalRequest.count({ where: { producerId: { in: ids.producerIds }, NOT: { restaurantId: shopId } } });
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
      const idList = list.map((r) => r.id).join(",");
      const t = await loadTarget(prisma, list.map((r) => r.id));
      const rp = await tradeProblems(prisma, t, false); // 受け取り完了は「--include-completed が必要」と示すだけにする
      const completed = list.some((r) => r.receivedAt);
      console.log(`  → 仕入れ案 ${fp.slice(0, 12)}…（${list.length}件・合計 ${list.reduce((n, r) => n + r.quantityKg, 0)}kg・やり取り ${t.messages.length}件・評価 ${t.reviews?.length ?? 0}件・いつもの農家 ${t.usuals?.length ?? 0}件${completed ? "・受け取り完了" : ""}）`);
      console.log(`     delete：${problems.length ? "できない" : `できる。--expect-ids ${idList}`}`);
      console.log(`     reset ：${rp.length ? `できない（${rp.join(" / ")}）` : `できる。--expect-ids ${idList}${completed ? " --include-completed（受け取り完了のため必要）" : ""}`}`);
    }
    return;
  }

  const expected = [...new Set((opt("--expect-ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean))].sort();

  if (mode === "delete") {
    const out = await prisma.$transaction(async (tx: any) => {
      const rows = await tx.approvalRequest.findMany({ where: { id: { in: expected } } });
      if (rows.length === 0) return { deleted: 0, note: "指定した相談はもうありません（何もしない）" };
      if (rows.length !== expected.length) throw new Guard(`指定した ID の一部だけが残っているため、何も消さない（残り ${rows.length}/${expected.length}件）`);
      for (const r of rows) {
        const p = await rowProblems(tx, r);
        if (p.length) throw new Guard(`${r.id} が条件に合わないため、何も消さない：${p.join("・")}`);
      }
      // 同じ仕入れ案（店・planFingerprint）の相談をすべて指定しているか（一部だけを消さない）
      const missing = await missingInPlans(tx, rows, expected);
      if (missing.length) throw new Guard(`同じ仕入れ案の相談 ${missing.join(",")} が指定されていないため、何も消さない`);
      const n = await tx.approvalRequest.deleteMany({ where: { id: { in: expected }, restaurantId: shopId, status: { in: allowedStatuses }, receivedAt: null } });
      if (n.count !== expected.length) throw new Guard(`削除件数が ${n.count}/${expected.length} 件のため取り消した`);
      return { deleted: n.count, note: expected.join(", ") };
    }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 20_000 });
    console.log(`削除しました：相談 ${out.deleted}件（${out.note}）`);
    return;
  }

  if (mode === "reset") {
    // 1. 読み取りで確かめる（ここで止まれば何も書かない）
    const pre = await loadTarget(prisma, expected);
    if (pre.approvals.length === 0) { console.log("指定した相談はもうありません（何もしない）"); return; }
    if (pre.approvals.length !== expected.length) throw new Guard(`指定した ID の一部だけが残っているため、何も変えない（残り ${pre.approvals.length}/${expected.length}件）`);
    const preProblems = await tradeProblems(prisma, pre, true);
    if (preProblems.length) throw new Guard(`条件に合わないため、何も変えない：${preProblems.join(" / ")}`);
    const preMissing = await missingInPlans(prisma, pre.approvals, expected);
    if (preMissing.length) throw new Guard(`同じ仕入れ案の相談 ${preMissing.join(",")} が指定されていないため、何も変えない`);

    // 2. バックアップ（消す前の行をそのまま JSON に保存する。上書きしない）
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const backup = { kind: BACKUP_KIND, target: targetName, endpoint: ALLOWED, createdAt: new Date().toISOString(), restaurantUserId: shopId, expectIds: expected, approvals: pre.approvals, messages: pre.messages, reviews: pre.reviews ?? [], usuals: pre.usuals ?? [], hash: targetHash(pre) };
    mkdirSync(OUT_DIR, { recursive: true });
    const file = resolve(OUT_DIR, `${stamp}.approvals-reset.backup.json`);
    writeFileSync(file, JSON.stringify(stable(backup), null, 1), { flag: "wx", mode: 0o600 });
    console.log(`バックアップ：${file}（相談 ${pre.approvals.length}件・やり取り ${pre.messages.length}件・評価 ${backup.reviews.length}件・いつもの農家 ${backup.usuals.length}件・hash ${backup.hash.slice(0, 12)}…）`);

    // 3. 1つのトランザクションで、確かめ直してから消す
    const out = await prisma.$transaction(async (tx: any) => {
      const cur = await loadTarget(tx, expected);
      if (cur.approvals.length === 0) return null;
      if (targetHash(cur) !== backup.hash) throw new Guard("バックアップのあとに対象の相談・やり取りが変わったため、何も変えない（もう一度 inspect から）");
      const p = await tradeProblems(tx, cur, true);
      if (p.length) throw new Guard(`条件に合わないため、何も変えない：${p.join(" / ")}`);
      const missing = await missingInPlans(tx, cur.approvals, expected);
      if (missing.length) throw new Guard(`同じ仕入れ案の相談 ${missing.join(",")} が指定されていないため、何も変えない`);
      const messageIds = cur.messages.map((m) => m.id);
      const before = await otherDataHash(tx, expected, messageIds);
      // 相談への外部キー（RESTRICT）があるので、いつもの農家・評価・やり取りを先に消す
      const usuals = cur.usuals ?? [], reviews = cur.reviews ?? [];
      const u = usuals.length ? await tx.usualProducer.deleteMany({ where: { approvalRequestId: { in: expected }, OR: usuals.map((x) => ({ restaurantUserId: x.restaurantUserId, producerId: x.producerId })) } }) : { count: 0 };
      if (u.count !== usuals.length) throw new Guard(`いつもの農家の削除件数が ${u.count}/${usuals.length} 件のため取り消した`);
      const v = reviews.length ? await tx.tradeReview.deleteMany({ where: { id: { in: reviews.map((x) => x.id) }, approvalRequestId: { in: expected } } }) : { count: 0 };
      if (v.count !== reviews.length) throw new Guard(`評価の削除件数が ${v.count}/${reviews.length} 件のため取り消した`);
      const m = await tx.tradeMessage.deleteMany({ where: { id: { in: messageIds }, approvalRequestId: { in: expected } } });
      if (m.count !== messageIds.length) throw new Guard(`やり取りの削除件数が ${m.count}/${messageIds.length} 件のため取り消した`);
      const a = await tx.approvalRequest.deleteMany({ where: { id: { in: expected }, restaurantId: shopId } });
      if (a.count !== expected.length) throw new Guard(`相談の削除件数が ${a.count}/${expected.length} 件のため取り消した`);
      const left = await loadTarget(tx, expected);
      if (left.approvals.length || left.messages.length || left.reviews?.length || left.usuals?.length) throw new Guard("対象の行が残っているため取り消した");
      const after = await otherDataHash(tx, expected, messageIds);
      const changed = diffTables(before, after);
      if (changed.length) throw new Guard(`対象外のデータが変わったため取り消した：${changed.join(", ")}`);
      return { approvals: a.count, messages: m.count, reviews: v.count, usuals: u.count, tables: Object.keys(before).length };
    }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 20_000 });
    if (!out) { console.log("指定した相談はもうありません（何もしない）"); return; }
    console.log(`相談前の状態に戻しました：相談 ${out.approvals}件・やり取り ${out.messages}件・評価 ${out.reviews}件・いつもの農家 ${out.usuals}件を削除（対象外の ${out.tables} テーブルは前後で一致）`);
    console.log(`元に戻すとき：restore --backup ${file}`);
    return;
  }

  // restore
  const b = backupIn!;
  const approvalIds: string[] = b.approvals.map((r: any) => r.id);
  const messageIds: string[] = b.messages.map((m: any) => m.id);
  const reviewsIn: any[] = b.reviews ?? [], usualsIn: any[] = b.usuals ?? [];
  const out = await prisma.$transaction(async (tx: any) => {
    const existA = await tx.approvalRequest.count({ where: { id: { in: approvalIds } } });
    const existM = await tx.tradeMessage.count({ where: { id: { in: messageIds } } });
    if (existA || existM) throw new Guard(`同じ ID の相談 ${existA}件・やり取り ${existM}件がすでにあるため、何も変えない（すでに戻してある可能性があります）`);
    if ((reviewsIn.length && !await hasTable(tx, "trade_reviews")) || (usualsIn.length && !await hasTable(tx, "usual_producers"))) throw new Guard("評価・いつもの農家の表がない DB のため、何も変えない");
    const existV = reviewsIn.length ? await tx.tradeReview.count({ where: { id: { in: reviewsIn.map((r) => r.id) } } }) : 0;
    const existU = usualsIn.length ? await tx.usualProducer.count({ where: { OR: usualsIn.map((u) => ({ restaurantUserId: u.restaurantUserId, producerId: u.producerId })) } }) : 0;
    if (existV || existU) throw new Guard(`同じ評価 ${existV}件・同じ店と農家のいつもの農家 ${existU}件がすでにあるため、何も変えない`);
    for (const r of b.approvals) {
      const dup = await tx.approvalRequest.findFirst({ where: { restaurantId: r.restaurantId, supplyId: r.supplyId, planFingerprint: r.planFingerprint }, select: { id: true } });
      if (dup) throw new Guard(`同じ仕入れ案の相談 ${dup.id} が新しく送られているため、何も変えない（先にその相談を reset してください）`);
      const s = await tx.supply.findUnique({ where: { id: r.supplyId }, select: { producerId: true } });
      if (!s || s.producerId !== r.producerId) throw new Guard(`相談 ${r.id} の出品がない（またはその農家の出品ではない）ため、何も変えない`);
    }
    const p = await tradeProblems(tx, b, false);
    if (p.length) throw new Guard(`条件に合わないため、何も変えない：${p.join(" / ")}`);
    const before = await otherDataHash(tx, approvalIds, messageIds);
    const date = (v: string | null) => (v ? new Date(v) : null);
    await tx.approvalRequest.createMany({ data: b.approvals.map((r: any) => ({ ...r, createdAt: date(r.createdAt), respondedAt: date(r.respondedAt), receivedAt: date(r.receivedAt) })) });
    if (b.messages.length) await tx.tradeMessage.createMany({ data: b.messages.map((m: any) => ({ ...m, createdAt: date(m.createdAt) })) });
    if (reviewsIn.length) await tx.tradeReview.createMany({ data: reviewsIn.map((r: any) => ({ ...r, createdAt: date(r.createdAt) })) });
    if (usualsIn.length) await tx.usualProducer.createMany({ data: usualsIn.map((u: any) => ({ ...u, createdAt: date(u.createdAt) })) });
    const now = await loadTarget(tx, approvalIds);
    if (targetHash(now) !== b.hash) throw new Guard("入れ直した行がバックアップと一致しないため取り消した");
    const after = await otherDataHash(tx, approvalIds, messageIds);
    const changed = diffTables(before, after);
    if (changed.length) throw new Guard(`対象外のデータが変わったため取り消した：${changed.join(", ")}`);
    return { approvals: approvalIds.length, messages: messageIds.length, reviews: reviewsIn.length, usuals: usualsIn.length };
  }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 20_000 });
  console.log(`バックアップから戻しました：相談 ${out.approvals}件・やり取り ${out.messages}件・評価 ${out.reviews}件・いつもの農家 ${out.usuals}件（元の ID・時刻・状態。対象外のデータは前後で一致）`);
}

try {
  await main();
} catch (e) {
  if (e instanceof Guard) { console.error(`中止：${e.message}`); process.exitCode = 1; }
  else { console.error(`失敗：${(e as Error).name}（何も変更していないか、トランザクションで取り消されています）`); process.exitCode = 1; }
} finally {
  await prisma?.$disconnect();
}
