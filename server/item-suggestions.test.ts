import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/item-suggestions：登録されていない品目名に、いま出品されている品目から近い食材を最大3件。
// 実際の OpenAI は呼ばず fetch を差し替える。DB は読み取り（item.findMany）だけを用意し、それ以外を呼んだら失敗にする（書き込まない）。

const ALL = [
  { id: "i-tomato", name: "トマト" }, { id: "i-nasu", name: "なす" }, { id: "i-kyuri", name: "きゅうり" },
  { id: "i-leaf", name: "小松菜" }, { id: "i-root", name: "ごぼう" }, { id: "i-onion", name: "玉ねぎ" },
  { id: "i-cat-leaf", name: "葉物" }, { id: "i-cat-root", name: "根菜" }, // マスタの大分類の名前（代替候補には出さない）
];
// listed：条件なし（いま出品中の全品目）、narrow：受け取り日・回の条件つき（null なら listed と同じ）
const mem = vi.hoisted(() => ({ listed: [] as { id: string; name: string }[], narrow: null as { id: string; name: string }[] | null, wheres: [] as unknown[], dbCalls: 0, userId: "u-r" }));

vi.mock("./db.js", () => {
  const item = {
    findMany: async (args: { where?: unknown }) => {
      mem.dbCalls++;
      if (!args?.where) return ALL;
      mem.wheres.push(args.where);
      const slot = (args.where as { supplies: { some: { slot: Record<string, unknown> } } }).supplies.some.slot;
      return (slot.startAt || slot.id) && mem.narrow ? mem.narrow : mem.listed;
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
  mem.listed = [ALL[0], ALL[2], ALL[3]]; // トマト・きゅうり・小松菜が出品中
  mem.narrow = null; mem.wheres = []; mem.dbCalls = 0; mem.userId = `u-r-${t}`;
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
  const sentOf = (i = 0) => JSON.parse(String(fetchMock.mock.calls[i][1]!.body));
  const enumOf = (i = 0) => sentOf(i).text.format.schema.properties.itemIds.items.enum;

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
    expect(r.data).toEqual({
      match: null, ai: "ok",
      suggestions: [{ id: "i-leaf", name: "小松菜", conditionAvailable: true }, { id: "i-kyuri", name: "きゅうり", conditionAvailable: true }, { id: "i-root", name: "ごぼう", conditionAvailable: true }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentOf().store).toBe(false);
    expect(enumOf()).toEqual(["i-tomato", "i-kyuri", "i-leaf", "i-root"]);
    expect(sentOf().input[0].content).toContain("黒キャベツ");
    expect(sentOf().input[0].content).not.toContain("なす"); // 出品のない品目は渡さない
    expect(sentOf().input[0].content).not.toContain("受け取れない"); // 受け取り日が決まっていなければ、条件外の印は付けない
  });

  it("候補は、締切前の回で公開中・残りありの出品がある品目。受け取り日・回が決まっていれば、その条件で出品があるかも読む", async () => {
    fetchMock.mockImplementation(async () => aiResponse({ itemIds: [] }));
    const later = () => vi.setSystemTime(new Date(Date.now() + 2000)); // 1秒の連打防止に掛からないように
    await post({ name: "黒キャベツ" });
    later();
    await post({ name: "ケール", desiredDate: "2026-10-27" });
    later();
    await post({ name: "春菊", desiredDate: "2026-10-27", slotId: "slot-1" });
    const some = (w: unknown) => (w as { supplies: { some: Record<string, unknown> } }).supplies.some;
    expect(mem.wheres).toHaveLength(5); // 条件なし1回 ＋（条件なし・条件つき）×2
    expect(some(mem.wheres[0])).toMatchObject({ published: true, availableKg: { gt: 0 }, slot: { confirmDeadlineAt: { gt: expect.any(Date) } } });
    expect((some(mem.wheres[0]).slot as Record<string, unknown>).startAt).toBeUndefined();
    expect((some(mem.wheres[2]).slot as { startAt: { gte: Date; lt: Date } }).startAt).toEqual({ gte: new Date("2026-10-26T15:00:00Z"), lt: new Date("2026-10-27T15:00:00Z") });
    expect(some(mem.wheres[4]).slot).toMatchObject({ id: "slot-1" });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1問い合わせにつき1回
  });

  it("希望日に出品がある具体的な食材（白菜）と、別日だけの食材（小松菜）を、印を付けて1回の呼び出しでまとめて渡す（条件内を先に）", async () => {
    const hakusai = { id: "i-hakusai", name: "白菜" };
    mem.narrow = [ALL[0], hakusai]; mem.listed = [ALL[0], ALL[3], hakusai];
    fetchMock.mockResolvedValueOnce(aiResponse({ itemIds: ["i-hakusai", "i-leaf"] }));
    const r = await post({ name: "キャベツ", desiredDate: "2026-10-27" });
    expect(r.data).toEqual({ match: null, ai: "ok", suggestions: [{ id: "i-hakusai", name: "白菜", conditionAvailable: true }, { id: "i-leaf", name: "小松菜", conditionAvailable: false }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enumOf()).toEqual(["i-tomato", "i-hakusai", "i-leaf"]); // 条件内を先に並べる
    const content = sentOf().input[0].content as string;
    expect(content).toContain("i-hakusai: 白菜\n");
    expect(content).toContain("i-leaf: 小松菜（希望の受け取り条件では受け取れない）");
    expect(sentOf().instructions).toContain("と書かれていない候補を優先します");
  });

  it("希望日には近い食材がなく、別日にある小松菜だけを AI が選んだとき：小松菜（条件外の印つき）。AI は1回だけ", async () => {
    mem.narrow = [ALL[0]]; mem.listed = [ALL[0], ALL[3]];
    fetchMock.mockResolvedValueOnce(aiResponse({ itemIds: ["i-leaf"] }));
    const r = await post({ name: "キャベツ", slotId: "slot-9" });
    expect(r).toEqual({ status: 200, data: { match: null, ai: "ok", suggestions: [{ id: "i-leaf", name: "小松菜", conditionAvailable: false }] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("近いものがない・AI が失敗・時間切れ・おかしな出力：候補なし（画面は「いま、この品目の出品はありません」）。失敗しても呼び直さない", async () => {
    mem.narrow = [ALL[0]];
    fetchMock.mockResolvedValueOnce(aiResponse({ itemIds: [] }));
    expect((await post({ name: "黒キャベツ", desiredDate: "2026-10-27" })).data).toEqual({ match: null, suggestions: [], ai: "ok" });
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 500 }));
    vi.setSystemTime(new Date(Date.now() + 5000));
    expect((await post({ name: "ケール", desiredDate: "2026-10-27" })).data).toEqual({ match: null, suggestions: [], ai: "failed" });
    fetchMock.mockResolvedValueOnce(aiResponse({ wrong: true }));
    vi.setSystemTime(new Date(Date.now() + 5000));
    expect((await post({ name: "春菊" })).data).toMatchObject({ suggestions: [], ai: "failed" });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    vi.setSystemTime(new Date(Date.now() + 5000));
    expect((await post({ name: "ほうれん草" })).data).toMatchObject({ suggestions: [], ai: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("出品中の品目がなければ・AI の設定がなければ、AI を呼ばずに候補なし", async () => {
    mem.listed = [];
    expect((await post({ name: "黒キャベツ" })).data).toEqual({ match: null, suggestions: [], ai: "skipped" });
    mem.listed = [ALL[3]];
    vi.stubEnv("OPENAI_MODEL", "");
    expect((await post({ name: "黒キャベツ" })).data).toEqual({ match: null, suggestions: [], ai: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("「葉物」「根菜」のような大分類は、出品中でも AI に渡さない（条件内・条件外とも）。具体的な食材がなければ候補なし", async () => {
    mem.narrow = [ALL[0], ALL[6]]; mem.listed = [ALL[0], ALL[2], ALL[6], ALL[7]];
    fetchMock.mockResolvedValueOnce(aiResponse({ itemIds: ["i-kyuri"] }));
    const r = await post({ name: "キャベツ", desiredDate: "2026-10-27" });
    expect(r.data).toEqual({ match: null, ai: "ok", suggestions: [{ id: "i-kyuri", name: "きゅうり", conditionAvailable: false }] });
    expect(enumOf()).toEqual(["i-tomato", "i-kyuri"]);
    expect(sentOf().input[0].content).not.toMatch(/葉物|根菜/);
    expect((mem.wheres[0] as { name: { notIn: string[] } }).name.notIn).toEqual(["葉物", "根菜"]);
    // 出品中が大分類だけなら、AI を呼ばずに候補なし
    fetchMock.mockReset();
    mem.narrow = null; mem.listed = [ALL[6], ALL[7]];
    vi.setSystemTime(new Date(Date.now() + 5000));
    expect((await post({ name: "白菜" })).data).toEqual({ match: null, suggestions: [], ai: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("「葉物」と書いた場合は、今までどおり登録済みの品目として扱う（候補として勧めないだけ）", async () => {
    expect((await post({ name: "葉物" })).data).toEqual({ match: { id: "i-cat-leaf", name: "葉物" }, suggestions: [], ai: "skipped" });
  });

  it("品目名の形でない入力は、DB も AI も使わずに候補なし", async () => {
    for (const name of ["", "<script>", "あ".repeat(21), 123]) expect((await post({ name })).data).toEqual({ match: null, suggestions: [], ai: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mem.dbCalls).toBe(0);
  });

  it("同じ名前・同じ候補なら結果を使い回す。AI の呼び出しは1秒に1回まで（超えたら 429）", async () => {
    fetchMock.mockImplementation(async () => aiResponse({ itemIds: ["i-leaf"] }));
    await post({ name: "黒キャベツ" });
    expect((await post({ name: "黒キャベツ" })).data.suggestions).toEqual([{ id: "i-leaf", name: "小松菜", conditionAvailable: true }]);
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
