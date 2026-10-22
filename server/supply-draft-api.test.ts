import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDraftInput, parseSupplyDraft } from "../src/lib/supply-draft.js";

// /api/supply-draft（生産者の出品の下書き：写真・話した内容 → AI）のテスト。実 API は呼ばず fetch をモックする。
// DB は品目の名前の読み取り（item.findMany）だけを用意し、それ以外を呼んだら失敗にする（下書きでは登録しない）。

vi.mock("./repo.js", () => ({
  repo: {
    findSessionUser: async (id: string) =>
      id === "u-r" ? { id, role: "restaurant", displayName: "飲食店R", producer: null, onboarded: true }
        : id === "u-a" ? { id, role: "producer", displayName: "A農園", producer: { id: "p-a", farmName: "A農園", originPrefecture: "大阪府" }, onboarded: true } : null,
  },
}));
vi.mock("./db.js", () => ({
  prisma: new Proxy({}, {
    get: (_, table) => new Proxy({}, {
      get: (__, op) => {
        if (table === "item" && op === "findMany") return async () => [{ name: "トマト" }, { name: "なす" }];
        throw new Error(`DB の ${String(table)}.${String(op)} は呼ばない`);
      },
    }),
  }),
}));

const { createSessionToken } = await import("./auth.js");
const extractApi = await import("../api/extract.js");

const aiResponse = (obj: unknown) =>
  new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] }), { status: 200 });
const fetchMock = vi.fn<typeof fetch>();
const cookie = (uid: string, role: "restaurant" | "producer") => `aic_session=${createSessionToken({ id: uid, role }, new Date())}`;
const call = (body: unknown, c = cookie("u-a", "producer")) =>
  extractApi.POST(new Request("http://localhost/api/supply-draft", { method: "POST", headers: { "Content-Type": "application/json", cookie: c }, body: JSON.stringify(body) }));
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
let seq = 0;

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-0123456789-abcdefghijklmnop";
  process.env.DEMO_NOW = "2026-10-22T12:00:00+09:00";
});
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.OPENAI_API_KEY = "test-key-not-real";
  process.env.OPENAI_MODEL = "test-model";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 22, 0, 0, seq++ * 10))); // 呼び出し間隔の制限（3秒）に掛からないよう時刻を進める
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("/api/supply-draft", () => {
  it("話した内容 → 品目・量・価格の下書き。今ある品目の名前を AI に渡し、文と品目は入力データとして囲む", async () => {
    fetchMock.mockResolvedValueOnce(aiResponse({ itemName: "なす", availableKg: 8, priceYenPerKg: 450, grade: null }));
    const r = await call({ text: "なす 8キロ 1キロ450円" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ draft: { itemName: "なす", availableKg: 8, priceYenPerKg: 450, grade: null } });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(sent.store).toBe(false);
    expect(sent.input[0].content).toContain("<話した内容>\nなす 8キロ 1キロ450円\n</話した内容>");
    expect(sent.input[0].content).toContain("トマト、なす");
  });
  it("写真 → 画像を入力に付けて送る（文字だけの入力にしない）", async () => {
    fetchMock.mockResolvedValueOnce(aiResponse({ itemName: "トマト", availableKg: null, priceYenPerKg: null, grade: null }));
    const r = await call({ image: PHOTO });
    expect(await r.json()).toEqual({ draft: { itemName: "トマト", availableKg: null, priceYenPerKg: null, grade: null } });
    const parts = JSON.parse(String(fetchMock.mock.calls[0][1]!.body)).input[0].content;
    expect(parts.map((p: { type: string }) => p.type)).toEqual(["input_text", "input_image"]);
    expect(parts[1].image_url).toBe(PHOTO);
  });
  it("写真だけ：AI が量・価格・規格を返しても下書きには入れない（品目だけ）。指示でも写真から推測しないよう伝える", async () => {
    fetchMock.mockResolvedValueOnce(aiResponse({ itemName: "トマト", availableKg: 10, priceYenPerKg: 500, grade: "irregular" }));
    const r = await call({ image: PHOTO });
    expect(await r.json()).toEqual({ draft: { itemName: "トマト", availableKg: null, priceYenPerKg: null, grade: null } });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body)).input[0].content[0].text).toContain("写真から量・価格・規格を推測しない");
    // 写真だけで品目も読めなければ、下書きなし（手入力へ）
    vi.setSystemTime(new Date(Date.now() + 5_000)); // 呼び出し間隔の制限（3秒）を越える。次のテストの時刻（+10秒）よりは前
    fetchMock.mockResolvedValueOnce(aiResponse({ itemName: null, availableKg: 10, priceYenPerKg: 500, grade: null }));
    expect((await call({ image: PHOTO })).status).toBe(422);
  });
  it("話した内容に「5kg」「1kg300円」と明示されていれば、量・価格を下書きに入れる", async () => {
    fetchMock.mockResolvedValueOnce(aiResponse({ itemName: "なす", availableKg: 5, priceYenPerKg: 300, grade: null }));
    expect(await (await call({ text: "なす 5kg 1kg300円" })).json()).toEqual({ draft: { itemName: "なす", availableKg: 5, priceYenPerKg: 300, grade: null } });
  });
  it("飲食店・未ログインは使えない。入力が空・形が違う写真は AI を呼ばない", async () => {
    expect((await call({ text: "なす" }, cookie("u-r", "restaurant"))).status).toBe(403);
    expect((await call({ text: "なす" }, "")).status).toBe(401);
    expect((await call({})).status).toBe(400);
    expect((await call({ image: "data:text/html;base64,PGI+" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("AI の設定がない・失敗・何も読み取れない：失敗として返し、画面は手入力へ案内する", async () => {
    delete process.env.OPENAI_MODEL;
    expect((await call({ text: "なす" })).status).toBe(503);
    process.env.OPENAI_MODEL = "test-model";
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect((await call({ text: "なす" })).status).toBe(502);
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 22, 1, 0, seq++ * 10)));
    fetchMock.mockResolvedValueOnce(aiResponse({ itemName: null, availableKg: null, priceYenPerKg: null, grade: null }));
    expect((await call({ text: "こんにちは" })).status).toBe(422);
  });
});

describe("下書きの確認（src/lib/supply-draft.ts）", () => {
  it("AI の出力は形が合う値だけ残す（範囲外の量・価格、記号の品目名は null）", () => {
    expect(parseSupplyDraft({ itemName: "<b>", availableKg: 0, priceYenPerKg: 100_001, grade: "best" })).toBeNull();
    expect(parseSupplyDraft({ itemName: " ミニトマト ", availableKg: 101, priceYenPerKg: 1.5, grade: "irregular" }))
      .toEqual({ itemName: "ミニトマト", availableKg: null, priceYenPerKg: null, grade: "irregular" });
    expect(parseSupplyDraft("トマト")).toBeNull();
  });
  it("入力は文字か写真のどちらか（文字は300文字まで、写真は jpeg/png/webp の data URL だけ）", () => {
    expect(parseDraftInput({ text: "  なす  " })).toEqual({ ok: true, value: { text: "なす", image: null } });
    expect(parseDraftInput({ image: PHOTO })).toEqual({ ok: true, value: { text: null, image: PHOTO } });
    expect(parseDraftInput({ text: "あ".repeat(301) }).ok).toBe(false);
    expect(parseDraftInput({ image: "https://example.com/a.jpg" }).ok).toBe(false);
    expect(parseDraftInput(null).ok).toBe(false);
  });
});
