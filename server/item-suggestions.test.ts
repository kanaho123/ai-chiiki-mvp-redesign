import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/item-suggestions：登録されていない品目名に、いま出品されている品目から近い食材を最大3件。
// 実際の OpenAI は呼ばず fetch を差し替える。DB は読み取り（item.findMany）だけを用意し、それ以外を呼んだら失敗にする（書き込まない）。

const ALL = [
  { id: "i-tomato", name: "トマト" }, { id: "i-nasu", name: "なす" }, { id: "i-kyuri", name: "きゅうり" },
  { id: "i-leaf", name: "葉物" }, { id: "i-root", name: "根菜" }, { id: "i-onion", name: "玉ねぎ" },
];
const mem = vi.hoisted(() => ({ listed: [] as { id: string; name: string }[], wheres: [] as unknown[], dbCalls: 0, userId: "u-r" }));

vi.mock("./db.js", () => {
  const item = {
    findMany: async (args: { where?: unknown }) => {
      mem.dbCalls++;
      if (!args?.where) return ALL;
      mem.wheres.push(args.where);
      return mem.listed;
    },
  };
  // item.findMany 以外（作成・更新・削除・ほかのテーブル）は呼ばれたら失敗
  const deny = (path: string): unknown => new Proxy(() => { throw new Error(`DB access not allowed: ${path}`); }, { get: (_t, k: string) => deny(`${path}.${k}`) });
  return { prisma: new Proxy({}, { get: (_t, k: string) => (k === "item" ? new Proxy(item, { get: (t, m: string) => (m in t ? (t as Record<string, unknown>)[m] : deny(`item.${m}`)) }) : deny(k)) }) };
});
// AI の呼び出し回数はユーザーごとに数えるので、テストごとに別のユーザーにする
vi.mock("./auth.js", () => ({ requireRole: async () => ({ ok: true, user: { id: mem.userId, role: "restaurant" } }) }));

const route = await import("./routes/item-suggestions.js");
const { clearSuggestCache } = await import("./item-suggestions.js");

const aiResponse = (obj: unknown) => new Response(JSON.stringify({
  status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }],
}), { status: 200 });
const fetchMock = vi.fn<typeof fetch>();
const post = async (body: unknown) => {
  const r = await route.POST(new Request("http://localhost/api/item-suggestions", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) }));
  return { status: r.status, data: await r.json() };
};
let t = 0;
beforeEach(() => {
  mem.listed = [ALL[0], ALL[2], ALL[3]]; // トマト・きゅうり・葉物が出品中
  mem.wheres = []; mem.dbCalls = 0; mem.userId = `u-r-${t}`;
  clearSuggestCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("APP_MODE", "general");
  vi.stubEnv("OPENAI_API_KEY", "test-key-not-real");
  vi.stubEnv("OPENAI_MODEL", "test-model");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 0, 0, (t += 10)))); // AI の呼び出し間隔の制限（1秒）に掛からないよう時刻を進める
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("近い食材の候補（飲食店・一般向けの環境）", () => {
  it("登録済みの品目（表記の違いも）なら、AI は呼ばずにその品目を返す", async () => {
    const r = await post({ name: "キュウリ" });
    expect(r).toEqual({ status: 200, data: { match: { id: "i-kyuri", name: "きゅうり" }, suggestions: [], ai: "skipped" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("黒キャベツ：AI に渡すのは出品中の品目だけ（返せる id も enum でそれだけ）。一覧にない id・重複は捨て、最大3件", async () => {
    mem.listed = [ALL[0], ALL[2], ALL[3], ALL[4]];
    fetchMock.mockResolvedValueOnce(aiResponse({ itemIds: ["i-leaf", "i-made-up", "i-leaf", "i-kyuri", "i-root", "i-tomato"] }));
    const r = await post({ name: "黒キャベツ" });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ match: null, suggestions: [{ id: "i-leaf", name: "葉物" }, { id: "i-kyuri", name: "きゅうり" }, { id: "i-root", name: "根菜" }], ai: "ok" });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(sent.store).toBe(false);
    expect(sent.text.format.schema.properties.itemIds.items.enum).toEqual(["i-tomato", "i-kyuri", "i-leaf", "i-root"]);
    expect(sent.input[0].content).toContain("黒キャベツ");
    expect(sent.input[0].content).not.toContain("なす"); // 出品のない品目は渡さない
  });

  it("候補は、締切前の回で公開中・残りありの出品がある品目。受け取り日・回が決まっていればその条件で絞る", async () => {
    fetchMock.mockResolvedValue(aiResponse({ itemIds: [] }));
    await post({ name: "黒キャベツ" });
    await post({ name: "ケール", desiredDate: "2026-10-27" });
    await post({ name: "小松菜", desiredDate: "2026-10-27", slotId: "slot-1" });
    const some = (w: unknown) => (w as { supplies: { some: Record<string, unknown> } }).supplies.some;
    expect(some(mem.wheres[0])).toMatchObject({ published: true, availableKg: { gt: 0 }, slot: { confirmDeadlineAt: { gt: expect.any(Date) } } });
    expect((some(mem.wheres[0]).slot as Record<string, unknown>).startAt).toBeUndefined();
    expect((some(mem.wheres[1]).slot as { startAt: { gte: Date; lt: Date } }).startAt).toEqual({ gte: new Date("2026-10-26T15:00:00Z"), lt: new Date("2026-10-27T15:00:00Z") });
    expect(some(mem.wheres[2]).slot).toMatchObject({ id: "slot-1" });
  });

  it("近いものがない・AI が失敗・時間切れ・おかしな出力：候補なし（画面は「いま、この品目の出品はありません」）", async () => {
    fetchMock.mockResolvedValueOnce(aiResponse({ itemIds: [] }));
    expect((await post({ name: "黒キャベツ" })).data).toEqual({ match: null, suggestions: [], ai: "ok" });
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 500 }));
    vi.setSystemTime(new Date(Date.now() + 5000));
    expect((await post({ name: "ケール" })).data).toEqual({ match: null, suggestions: [], ai: "failed" });
    fetchMock.mockResolvedValueOnce(aiResponse({ wrong: true }));
    vi.setSystemTime(new Date(Date.now() + 5000));
    expect((await post({ name: "小松菜" })).data).toMatchObject({ suggestions: [], ai: "failed" });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    vi.setSystemTime(new Date(Date.now() + 5000));
    expect((await post({ name: "ほうれん草" })).data).toMatchObject({ suggestions: [], ai: "failed" });
  });

  it("出品中の品目がなければ・AI の設定がなければ、AI を呼ばずに候補なし", async () => {
    mem.listed = [];
    expect((await post({ name: "黒キャベツ" })).data).toEqual({ match: null, suggestions: [], ai: "skipped" });
    mem.listed = [ALL[3]];
    vi.stubEnv("OPENAI_MODEL", "");
    expect((await post({ name: "黒キャベツ" })).data).toEqual({ match: null, suggestions: [], ai: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("品目名の形でない入力は、DB も AI も使わずに候補なし", async () => {
    for (const name of ["", "<script>", "あ".repeat(21), 123]) expect((await post({ name })).data).toEqual({ match: null, suggestions: [], ai: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mem.dbCalls).toBe(0);
  });

  it("同じ名前・同じ候補なら結果を使い回す。AI の呼び出しは1秒に1回まで（超えたら 429）", async () => {
    fetchMock.mockResolvedValue(aiResponse({ itemIds: ["i-leaf"] }));
    await post({ name: "黒キャベツ" });
    expect((await post({ name: "黒キャベツ" })).data.suggestions).toEqual([{ id: "i-leaf", name: "葉物" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await post({ name: "ケール" })).status).toBe(429);
  });

  it("回数の上限はない（1秒の間隔をあければ、何回でも AI の候補を出せる）", async () => {
    fetchMock.mockImplementation(async () => aiResponse({ itemIds: ["i-leaf"] }));
    for (let i = 0; i < 15; i++) {
      vi.setSystemTime(new Date(Date.now() + 1100));
      expect((await post({ name: `黒キャベツ${i}号` })).data).toMatchObject({ suggestions: [{ id: "i-leaf" }], ai: "ok" });
    }
    expect(fetchMock).toHaveBeenCalledTimes(15);
  });

  it("デモ用の環境では使わない（404）", async () => {
    vi.stubEnv("APP_MODE", "demo");
    vi.stubEnv("DEMO_NOW", "2026-10-22T12:00:00+09:00");
    expect((await post({ name: "黒キャベツ" })).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
