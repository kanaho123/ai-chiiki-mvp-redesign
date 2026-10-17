import { defineConfig } from "prisma/config";
import { loadApprovalEnvironment } from "./server/local-env.js";

// ローカルでは Vercel から取り込んだ .env.local の接続情報を使う（Git には含めない）。
// Vercel 上では環境変数が直接設定されているので、ファイルが無くてもよい。
// Generate/validate are offline. Any other Prisma CLI operation requires approval-dev,
// including direct CLI invocations which bypass package.json wrappers.
const offline = ["generate", "validate", "format", "version", "--version", "-v"].includes(process.argv[2] ?? "");
if (!offline) loadApprovalEnvironment();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
});
