import { describe, expect, it, vi } from "vitest";
import { handle } from "./http.js";

describe("API の共通エラー処理", () => {
  it("DB エラー等の例外は 500 の一般的な文言だけを返し、接続情報・エラー内容を出さない（候補0件とは区別）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = handle(async () => {
      throw new Error("Can't reach database server at ep-secret-host.neon.tech: password=hunter2");
    });
    const r = await api(new Request("http://localhost/api/plan", { method: "POST" }));
    expect(r.status).toBe(500);
    const body = await r.text();
    expect(JSON.parse(body)).toEqual({ error: "サーバーで問題が発生しました。時間をおいてもう一度お試しください" });
    expect(body).not.toMatch(/ep-secret-host|hunter2|database/);
    expect(r.headers.get("cache-control")).toBe("no-store");
    // ログにもエラーの種類名だけを残す（メッセージ本文は出さない）
    expect(spy).toHaveBeenCalledWith("Error", "");
    spy.mockRestore();
  });
  it("Prisma 等のエラーコード（例：P2028）はログに残す。メッセージ・不正な形のコードは出さない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fail = (code: unknown) => handle(async () => {
      throw Object.assign(new Error("Transaction already closed: postgresql://u:hunter2@ep-secret-host/neondb"), { name: "PrismaClientKnownRequestError", code });
    })(new Request("http://localhost/api/x"));
    expect((await fail("P2028")).status).toBe(500);
    expect(spy).toHaveBeenLastCalledWith("PrismaClientKnownRequestError", "P2028");
    await fail("postgresql://u:hunter2@host");
    expect(spy).toHaveBeenLastCalledWith("PrismaClientKnownRequestError", "");
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/hunter2|ep-secret-host|Transaction already closed/);
    spy.mockRestore();
  });
});
