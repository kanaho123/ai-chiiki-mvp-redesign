// Vercel Functions 共通の応答ヘルパー。DB エラーの詳細（接続情報を含みうる）は返さない。
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 10_000) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function handle(fn: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      return await fn(request);
    } catch (e) {
      console.error(e instanceof Error ? e.name : "UnknownError");
      return json({ error: "サーバーで問題が発生しました。時間をおいてもう一度お試しください" }, 500);
    }
  };
}
