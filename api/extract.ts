import { resolveExtraction } from "../src/lib/resolve.js";
import { parseExtraction, parseRequestText } from "../src/lib/validate.js";
import { AiError, extractWithGemini, geminiConfig, type AiErrorCode } from "../server/ai/gemini.js";
import { requireRole } from "../server/auth.js";
import { loadCatalog } from "../server/catalog.js";
import { serverNow } from "../server/clock.js";
import { handle, json, readJson } from "../server/http.js";
import { IntervalLimiter } from "../server/rate-limit.js";

// 自然文 → AI による条件候補の抽出 → 登録データへの照合（通常処理）。計算はしない（確定後に /api/plan）。
// AI が使えない・失敗した場合は「候補0件」ではなく失敗として返し、画面は入力文を残したまま手入力へ切り替える。

const AI_ERROR_STATUS: Record<AiErrorCode, number> = { AI_UNAVAILABLE: 503, AI_TIMEOUT: 504, AI_FAILED: 502, AI_INVALID_OUTPUT: 502 };
const AI_ERROR_TEXT = "AIで条件を読み取れませんでした。入力内容を残したまま手入力できます。";

// 連続呼び出しの制限（同じユーザーは 3 秒に1回まで。サーバーのインスタンスごとの簡易的な制限）
const extractLimiter = new IntervalLimiter(3000);

export const POST = handle(async (request) => {
  const g = await requireRole(request, "restaurant");
  if (!g.ok) return g.response;
  const text = parseRequestText(await readJson(request));
  if (!text.ok) return json({ error: text.error, code: "INVALID_INPUT" }, 400); // 空欄・1,000文字超は AI を呼ばない

  const cfg = geminiConfig();
  if (!cfg) return json({ error: AI_ERROR_TEXT, code: "AI_UNAVAILABLE" }, AI_ERROR_STATUS.AI_UNAVAILABLE);

  if (!extractLimiter.take(g.user.id))
    return json({ error: "少し時間をおいてからもう一度お試しください", code: "RATE_LIMITED" }, 429);

  let raw: unknown;
  try {
    raw = await extractWithGemini(text.value, cfg);
  } catch (e) {
    const code: AiErrorCode = e instanceof AiError ? e.code : "AI_FAILED";
    return json({ error: AI_ERROR_TEXT, code }, AI_ERROR_STATUS[code]);
  }
  const extracted = parseExtraction(raw);
  if (!extracted.ok) return json({ error: AI_ERROR_TEXT, code: "AI_INVALID_OUTPUT" }, AI_ERROR_STATUS.AI_INVALID_OUTPUT);

  const catalog = await loadCatalog(g.user.id);
  const r = resolveExtraction(extracted.value, catalog, serverNow());
  return json({ extracted: extracted.value, draft: r.draft, unresolvedFields: r.unresolvedFields, candidateMatches: r.candidateMatches, notices: r.notices });
});
