// 一般ユーザー向けの開発DBに、マスタ・運営データ（品目・品種「指定なし」・受渡拠点・定期枠・実際の回）だけを作る。
// デモ用のユーザー・在庫・依頼は作らない（reset-demo とは完全に別）。何度実行しても重複しない。
// 使い方: npm run db:seed-general-master
// 接続先は .env.general.local の GENERAL_DB_ENDPOINT と完全一致する開発DBだけ（デモ用・元アプリのDB・Vercel 上では停止する）。
import { loadGeneralEnvironment } from "../server/local-env.js";
loadGeneralEnvironment();

const { describeDb } = await import("../server/db-safety.js");
const { prisma } = await import("../server/db.js");
const { seedGeneralMaster } = await import("../server/general-master.js");

console.log(`接続先: ${describeDb(process.env.DATABASE_URL)}（一般ユーザー向けの開発DBと確認済み）`);
try {
  const r = await seedGeneralMaster(prisma, new Date());
  console.log(`品目 ${r.items}件・品種「指定なし」 ${r.varieties}件・受渡拠点 ${r.places}件・定期枠 ${r.series}件を確認／作成しました`);
  console.log(`実際の受渡の回：新しく ${r.slotsCreated}件作成・参加者 ${r.participantsAdded}件追加（既存の回はそのまま。止めている定期枠 ${r.inactiveSeries}件は新しい回を作らない）`);
} finally {
  await prisma.$disconnect();
}
