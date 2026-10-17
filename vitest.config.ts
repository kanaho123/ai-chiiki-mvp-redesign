import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    // テストは既定で demo mode（実DBには接続しない）。general mode の確認は各テストで env を切り替える
    env: { APP_MODE: "demo" },
  },
});
