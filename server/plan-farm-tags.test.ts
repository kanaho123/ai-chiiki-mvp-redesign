import { describe, expect, it, vi } from "vitest";

// 仕入れ案の農家に添える「対応できる取引」のタグ。表示のためだけに読み、ほかのテーブルは読まない・書かない。
const findMany = vi.fn(async (q: { where: { id: { in: string[] } } }) =>
  [{ id: "p-a", capabilities: ["surplus", "direct_talk", "irregular"] }, { id: "p-b", capabilities: ["surplus"] }, { id: "p-c", capabilities: [] }].filter((p) => q.where.id.in.includes(p.id)));
vi.mock("./db.js", () => ({ prisma: { producer: { findMany } } }));
const { loadFarmTags } = await import("./plan-data.js");

describe("loadFarmTags", () => {
  it("農家ごとに、規格外OK・少量OK・直接取引OK に当たるものだけを決まった順で返す。余剰だけ・なしの農家は含めない", async () => {
    expect(await loadFarmTags(["p-a", "p-b", "p-c", "p-a"])).toEqual({ "p-a": ["irregular", "direct_talk"] });
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ["p-a", "p-b", "p-c"] } }, select: { id: true, capabilities: true } });
  });
  it("農家がいなければ DB を読まない", async () => {
    findMany.mockClear();
    expect(await loadFarmTags([])).toEqual({});
    expect(findMany).not.toHaveBeenCalled();
  });
});
