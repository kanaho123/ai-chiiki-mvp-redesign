// URL と、それを受け持つ Vercel Function（api/*.ts）の対応表。vercel.json の rewrites と開発サーバー（vite.config.ts）で同じものを使う。
// vercel.json と一致していることはテスト（server/router.test.ts）で確かめる。
// 各 Function の中の振り分け（どの URL をどの処理に渡すか）は api/*.ts にある。

export const API_FUNCTIONS = {
  auth: ["/api/auth/:route"],
  onboarding: ["/api/onboarding/:route"],
  approvals: ["/api/approvals", "/api/approvals/received", "/api/approvals/:id", "/api/approvals/:id/messages"],
  supplies: ["/api/supplies", "/api/supplies/:id"],
  account: ["/api/me", "/api/inbox", "/api/profile", "/api/pickup-points"],
  purchase: ["/api/catalog", "/api/inventory-version", "/api/plan", "/api/plan-options", "/api/item-suggestions"],
  extract: ["/api/extract"],
} as const;
export type ApiFunction = keyof typeof API_FUNCTIONS;

/** vercel.json に書く rewrites（Function のファイルと同じ URL のものは、そのまま届くので書かない） */
export function vercelRewrites() {
  return Object.entries(API_FUNCTIONS).flatMap(([fn, sources]) =>
    sources.filter((s) => s !== `/api/${fn}`).map((source) => ({ source, destination: `/api/${fn}?__path=${source}` })),
  );
}

/** URL のパスから、受け持つ Function の名前を返す（なければ null） */
export function functionFor(pathname: string): ApiFunction | null {
  const path = pathname.replace(/\/+$/, "");
  for (const [fn, sources] of Object.entries(API_FUNCTIONS)) {
    for (const s of sources) {
      const re = new RegExp(`^${s.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg)).join("/")}$`);
      if (re.test(path)) return fn as ApiFunction;
    }
  }
  return null;
}
