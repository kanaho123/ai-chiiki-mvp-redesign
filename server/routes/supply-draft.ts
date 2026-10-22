import { DRAFT_IMAGE_MAX, parseDraftInput, parseSupplyDraft } from "../../src/lib/supply-draft.js";
import { AiError, draftSupplyWithOpenAi, openAiConfig } from "../ai/openai.js";
import { requireRole } from "../auth.js";
import { prisma } from "../db.js";
import { handle, json } from "../http.js";
import { IntervalLimiter } from "../rate-limit.js";

// 生産者の出品の下書き：写真、または話した内容 → AI → 品目・量・価格・規格の候補（生産者だけ）。
// 登録はしない。生産者が画面で確かめて直してから、今までの出品の API（/api/supplies）で登録する。
// AI が使えない・失敗したときは、画面が手入力へ切り替えられるよう失敗として返す（写真・文は記録しない）。

const AI_ERROR_TEXT = "AIで読み取れませんでした。手で入力してください";
// 連続呼び出しの制限（同じユーザーは 3 秒に1回まで。サーバーのインスタンスごとの簡易的な制限）
const draftLimiter = new IntervalLimiter(3000);

export const POST = handle(async (request) => {
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  // 写真の data URL を受けるので、ほかの API（readJson は 1万文字まで）より大きい上限で読む
  const body = await request.text();
  if (body.length > DRAFT_IMAGE_MAX + 2_000) return json({ error: "写真が大きすぎます。もう一度撮ってください" }, 413);
  let raw: unknown = null;
  try { raw = JSON.parse(body); } catch {}
  const input = parseDraftInput(raw);
  if (!input.ok) return json({ error: input.error }, 400);

  const cfg = openAiConfig();
  if (!cfg) return json({ error: AI_ERROR_TEXT, code: "AI_UNAVAILABLE" }, 503);
  if (!draftLimiter.take(g.user.id)) return json({ error: "少し時間をおいてからもう一度お試しください", code: "RATE_LIMITED" }, 429);

  const items = await prisma.item.findMany({ select: { name: true }, orderBy: { name: "asc" }, take: 300 });
  let out: unknown;
  try {
    out = await draftSupplyWithOpenAi(input.value, items.map((i) => i.name), cfg);
  } catch (e) {
    return json({ error: AI_ERROR_TEXT, code: e instanceof AiError ? e.code : "AI_FAILED" }, 502);
  }
  const draft = parseSupplyDraft(out, input.value); // 写真だけなら品目だけを残す（数量・価格は写真から推測しない）
  if (!draft) return json({ error: "品目を読み取れませんでした。手で入力してください", code: "NOTHING_FOUND" }, 422);
  return json({ draft });
});
