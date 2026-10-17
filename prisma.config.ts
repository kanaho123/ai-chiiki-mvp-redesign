import { defineConfig } from "prisma/config";
import { loadLocalEnvironment } from "./server/local-env.js";

// ローカルでは Vercel から取り込んだ .env.local の接続情報を使う（Git には含めない）。
// Vercel 上では環境変数が直接設定されているので、ファイルが無くてもよい。
// generate/validate などは DB に接続しない。それ以外の Prisma CLI の操作は開発DBだけを許可する
// （既定はデモ用の開発DB。一般ユーザー向けの開発DBは AIC_LOCAL_ENV=general を付けて実行する）。
const offline = ["generate", "validate", "format", "version", "--version", "-v"].includes(process.argv[2] ?? "");
if (!offline) loadLocalEnvironment();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
});
