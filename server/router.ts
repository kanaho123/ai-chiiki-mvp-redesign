import { json } from "./http.js";

// Vercel の Functions の数（Hobby は1回の deploy で12個まで）を減らすため、機能ごとに1つの Function にまとめる薄い振り分け。
// ・各 API の処理（server/routes/*）は元のまま。認証・ロール・本人確認・Origin の確認・APP_MODE の確認は各処理の中で行う
// ・URL は変えない：Vercel では vercel.json の rewrites（server/api-map.ts と同じ表）で、元の URL を __path に入れて渡す
//   （開発サーバーでは元の URL のまま届く）。ここで元の URL に戻してから各処理を呼ぶ
// ・表にない URL は 404、その URL で使えないメソッドは 405

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Handler = (request: Request) => Promise<Response>;
export type RouteModule = Partial<Record<Method, Handler>>;
const METHODS: Method[] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/** "/api/approvals/:id" のような形を、その URL に合うかどうかの正規表現にする（:xxx は「/ を含まない1区切り」） */
const toRegExp = (pattern: string) =>
  new RegExp(`^${pattern.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"))).join("/")}$`);

export function createRouter(routes: Record<string, RouteModule>) {
  const table = Object.entries(routes).map(([pattern, mod]) => ({ re: toRegExp(pattern), mod }));
  const route: Handler = async (request) => {
    const url = new URL(request.url);
    const forwarded = url.searchParams.get("__path");
    url.searchParams.delete("__path");
    const path = (forwarded ?? url.pathname).replace(/\/+$/, "") || "/";
    // Vercel の rewrite は、パスの名前付きの部分（:route・:id）もクエリに足して渡す。元の URL にはないので取り除く
    if (forwarded) {
      const last = path.split("/").at(-1);
      for (const name of ["route", "id"]) if (url.searchParams.get(name) === last) url.searchParams.delete(name);
    }
    if (!path.startsWith("/api/") || path.includes("..") || path.includes("//")) return json({ error: "見つかりません" }, 404);
    const hit = table.find((r) => r.re.test(path));
    if (!hit) return json({ error: "見つかりません" }, 404);
    const handler = hit.mod[request.method as Method];
    if (!handler) {
      const allow = METHODS.filter((m) => hit.mod[m]).join(", ");
      return Response.json({ error: "この操作はできません" }, { status: 405, headers: { Allow: allow, "Cache-Control": "no-store" } });
    }
    // 各処理には元の URL（パスとクエリ）で届ける。本文・ヘッダー（Cookie・Origin など）はそのまま渡す
    url.pathname = path;
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? await request.arrayBuffer() : undefined;
    return handler(new Request(url, { method: request.method, headers: request.headers, body }));
  };
  return { GET: route, POST: route, PATCH: route, PUT: route, DELETE: route };
}
