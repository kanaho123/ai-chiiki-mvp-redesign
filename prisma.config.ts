import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// ローカルでは Vercel から取り込んだ .env.local の接続情報を使う（Git には含めない）。
// Vercel 上では環境変数が直接設定されているので、ファイルが無くてもよい。
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
});
