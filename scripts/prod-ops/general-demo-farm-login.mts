// 一般向けの DB（--target dev|production）で、3農家デモの「デモ A農園（架空）」だけをログインできるようにする／元に戻す運用ツール。
// 既存の認証方式（メール＋パスワード・scrypt）をそのまま使い、A農園のユーザーの passwordHash だけを変える。
// 生産者・出品・場所・回・品目・相談など、ほかの行・列は変えない。新しい認証方式やバイパスは作らない。
//
// 使い方（リポジトリ直下で。接続情報は ENV_FILE だけから読む・表示しない。記録は AIC_OPS_DATA_DIR（既定 ~/.ai-chiiki-ops/demo-data））：
//   npx tsx scripts/prod-ops/general-demo-farm-login.mts inspect --target production --ids <data>/<日時>.ids.json
//       … 読み取りのみ。対象のユーザー・生産者と、ログインできる状態かを確かめる
//   npx tsx scripts/prod-ops/general-demo-farm-login.mts set --target production --ids <ids.json> --confirm <CONFIRM_SET>
//       … ランダムなパスワードを設定し、ログイン情報を <data>/<日時>.farm-a-login.local（本人だけが読める）に、
//         変更前の状態を <data>/<日時>.farm-a-login.before.json に保存する（どちらも Git に入れない。値は表示しない）
//   npx tsx scripts/prod-ops/general-demo-farm-login.mts rollback --target production --ids <ids.json> --before <before.json> --confirm <CONFIRM_ROLLBACK>
//       … 認証情報（passwordHash）だけを変更前に戻す。今の値がこのツールで設定した値のままのときだけ戻す
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── 接続先（--target dev か --target production で選ぶ。指定がなければ動かない） ──
const TARGETS = {
  production: {
    ALLOWED: "ep-bitter-credit-b8fbhoir", ENV_FILE: ".env.general.production.local", ENDPOINT_KEY: "GENERAL_PROD_DB_ENDPOINT", LABEL: "一般向け Production DB",
    CONFIRM_SET: "GENERAL_PRODUCTION_DEMO_FARM_A_LOGIN_SET", CONFIRM_ROLLBACK: "GENERAL_PRODUCTION_DEMO_FARM_A_LOGIN_ROLLBACK",
  },
  dev: {
    ALLOWED: "ep-polished-surf-b82ja29g", ENV_FILE: ".env.general.local", ENDPOINT_KEY: "GENERAL_DB_ENDPOINT", LABEL: "一般向け dev DB",
    CONFIRM_SET: "GENERAL_DEV_DEMO_FARM_A_LOGIN_SET", CONFIRM_ROLLBACK: "GENERAL_DEV_DEMO_FARM_A_LOGIN_ROLLBACK",
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
const COUNT_TABLES = ["users", "producers", "supplies", "approval_requests", "trade_messages"];
class Guard extends Error {}
const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
let prisma: any = null;
/** 値そのものではなく、一致の確認に使う短い指紋 */
const fingerprint = (s: string | null) => (s === null ? null : createHash("sha256").update(s).digest("hex").slice(0, 16));

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

const counts = async (tx: any) => {
  const c: Record<string, number> = {};
  for (const t of COUNT_TABLES) c[t] = ((await tx.$queryRawUnsafe(`SELECT count(*)::int n FROM "${t}"`)) as any[])[0].n;
  return c;
};

/** 対象（A農園とそのユーザー）の確認。想定外があれば止める（読み取り） */
async function target(tx: any, ids: { producerIds: string[]; userIds: string[] }) {
  const producers = await tx.producer.findMany({ where: { farmName: FARM_A }, select: { id: true, ownerUserId: true } });
  const a = producers.find((p: any) => ids.producerIds.includes(p.id));
  const problems: string[] = [];
  if (producers.length !== 1) problems.push(`「${FARM_A}」の生産者が ${producers.length}件（1件のはず）`);
  if (!a) problems.push("A農園の ID がデモの記録にない");
  const user = a ? await tx.user.findUnique({ where: { id: a.ownerUserId }, select: { id: true, role: true, email: true, loginId: true, passwordHash: true, displayName: true, onboardedAt: true } }) : null;
  if (a && !user) problems.push("A農園のユーザーがない");
  if (user) {
    if (!ids.userIds.includes(user.id)) problems.push("A農園のユーザーの ID がデモの記録にない");
    if (user.role !== "producer") problems.push(`ユーザーの役割が producer ではない（${user.role}）`);
    if (!user.email?.startsWith("demo-farm-a-") || !user.email.endsWith("@example.invalid")) problems.push("メールがデモ用（demo-farm-a-…@example.invalid）ではない");
    const owned = await tx.producer.count({ where: { ownerUserId: user.id } });
    if (owned !== 1) problems.push(`このユーザーが持つ生産者が ${owned}件（共有されている）`);
    const restaurant = await tx.restaurant.count({ where: { ownerUserId: user.id } });
    if (restaurant !== 0) problems.push("このユーザーが飲食店も持っている");
    if (user.passwordHash !== null && !String(user.passwordHash).startsWith("scrypt$")) problems.push("既存の認証情報の形式が想定と違う");
  }
  return { a, user, problems };
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
    console.log(`生産者：${t.a ? `${FARM_A}（ID はデモの記録と一致）` : "なし"}`);
    console.log(`ユーザー：${t.user ? `あり・役割 ${t.user.role}・メール ${t.user.email}・オンボーディング ${t.user.onboardedAt ? "済み" : "未"}` : "なし"}`);
    console.log(`ログインできる認証情報：${t.user?.passwordHash ? "設定されている（scrypt）" : "なし（passwordHash が null）"}`);
    console.log(`件数：${JSON.stringify(await counts(prisma))}`);
    console.log(t.problems.length ? `→ 想定外：${t.problems.join(" / ")}` : "→ 想定どおり（A農園のユーザーだけを変更すればよい）");
    if (t.problems.length) process.exitCode = 2;
    return;
  }

  const { hashPassword } = await import(pathToFileURL(resolve(process.cwd(), "server/auth.ts")).href);
  if (mode === "set") {
    const password = randomBytes(24).toString("base64url"); // 32文字
    const passwordHash = await hashPassword(password);
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const out = await prisma.$transaction(async (tx: any) => {
      const t = await target(tx, ids);
      if (t.problems.length) throw new Guard(`想定外のため何も変えない：${t.problems.join(" / ")}`);
      const before = await counts(tx);
      const n = await tx.user.updateMany({ where: { id: t.user.id, role: "producer", email: t.user.email, passwordHash: t.user.passwordHash }, data: { passwordHash } });
      if (n.count !== 1) throw new Guard(`更新が ${n.count}件のため取り消した`);
      const after = await counts(tx);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Guard("件数が変わったため取り消した");
      return { userId: t.user.id, email: t.user.email, previousHash: t.user.passwordHash as string | null, before, after };
    }, { isolationLevel: "Serializable", timeout: 60_000, maxWait: 20_000 });
    mkdirSync(OUT_DIR, { recursive: true });
    const loginFile = resolve(OUT_DIR, `${stamp}.farm-a-login.local`);
    writeFileSync(loginFile, JSON.stringify({ email: out.email, password }), { flag: "wx", mode: 0o600 });
    // 変更前の状態（元に戻すため）。以前の値があれば認証情報と同じ扱い（本人だけ・Git に入れない）
    const beforeFile = resolve(OUT_DIR, `${stamp}.farm-a-login.before.json`);
    writeFileSync(beforeFile, JSON.stringify({ endpoint: ALLOWED, userId: out.userId, previousPasswordHash: out.previousHash, setHashFingerprint: fingerprint(passwordHash), at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    for (const f of [loginFile, beforeFile]) try { chmodSync(f, 0o600); } catch {}
    console.log(`設定しました：${FARM_A} のユーザー（${out.email}）の passwordHash だけ（変更前：${out.previousHash === null ? "なし" : "あり"}）`);
    console.log(`件数（前→後）：${JSON.stringify(out.before)} → ${JSON.stringify(out.after)}`);
    console.log(`ログイン情報（パスワードは表示しない）：${loginFile}`);
    console.log(`元に戻すための記録：${beforeFile}`);
    return;
  }

  // rollback：認証情報だけを、変更前に戻す
  const before = JSON.parse(readFileSync(resolve(opt("--before")!), "utf8"));
  if (before.endpoint !== ALLOWED) throw new Guard("before.json の接続先が違うため中止");
  const out = await prisma.$transaction(async (tx: any) => {
    const t = await target(tx, ids);
    if (t.problems.length) throw new Guard(`想定外のため何も変えない：${t.problems.join(" / ")}`);
    if (t.user.id !== before.userId) throw new Guard("記録のユーザーと違うため何も変えない");
    if (t.user.passwordHash === before.previousPasswordHash) return { changed: 0, note: "すでに変更前の状態（何もしない）" };
    if (fingerprint(t.user.passwordHash) !== before.setHashFingerprint) throw new Guard("このツールで設定したあとに認証情報が変わっているため、何も変えない");
    const c0 = await counts(tx);
    const n = await tx.user.updateMany({ where: { id: t.user.id, passwordHash: t.user.passwordHash }, data: { passwordHash: before.previousPasswordHash } });
    if (n.count !== 1) throw new Guard(`更新が ${n.count}件のため取り消した`);
    if (JSON.stringify(c0) !== JSON.stringify(await counts(tx))) throw new Guard("件数が変わったため取り消した");
    return { changed: 1, note: `passwordHash を変更前（${before.previousPasswordHash === null ? "なし" : "以前の値"}）に戻した` };
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
