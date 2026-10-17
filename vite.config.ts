import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { loadApprovalEnvironment } from "./server/local-env.js";

/**
 * 開発時だけ、/api/* へのリクエストを api/ フォルダの関数（Vercel Functions と同じファイル）で処理する。
 * 本番（Vercel）では Vercel Functions がそのまま使われる。
 */
function localApi(): Plugin {
  const apiDir = path.resolve(import.meta.dirname, "api");

  // /api/plan → api/plan.ts、/api/listings → api/listings/index.ts、/api/listings/xxx → api/listings/[id].ts
  function resolve(pathname: string): string | null {
    const rel = pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    for (const f of [`${rel}.ts`, `${rel}/index.ts`]) {
      const p = path.join(apiDir, f);
      if (rel && existsSync(p)) return p;
    }
    if (!rel) return existsSync(path.join(apiDir, "index.ts")) ? path.join(apiDir, "index.ts") : null;
    const parent = path.join(apiDir, path.dirname(rel));
    for (const f of ["[id].ts"]) if (existsSync(path.join(parent, f))) return path.join(parent, f);
    return null;
  }

  async function readBody(req: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    return Buffer.concat(chunks);
  }

  return {
    name: "local-vercel-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/") && req.url !== "/api") return next();
        try {
          const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
          const file = resolve(url.pathname);
          if (!file) {
            res.statusCode = 404;
            return res.end();
          }
          const mod = await server.ssrLoadModule(file);
          const method = req.method ?? "GET";
          const handler = mod[method];
          if (typeof handler !== "function") {
            res.statusCode = 405;
            return res.end();
          }
          const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
          const response: Response = await handler(new Request(url, { method, headers, body }));
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          server.config.logger.error(`[api] ${e instanceof Error ? e.name : "Error"}`);
          res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

export default defineConfig(({ command }) => {
  if (command === "serve") {
    // .env.local（Vercel から取り込んだ接続情報）を API 関数用に読み込む。
    // VITE_ で始まらない変数はブラウザ側には渡らない。
    loadApprovalEnvironment();
  }
  return {
    plugins: [react(), localApi()],
    // Disable Vite's automatic .env.local loading, including VITE_ values from Production.
    envDir: false,
    // Dev Container 内から VS Code のポート転送で開けるようにする
    server: { host: true, port: 5173 },
  };
});
