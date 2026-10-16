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
    expect(spy).toHaveBeenCalledWith("Error");
    spy.mockRestore();
  });
});
