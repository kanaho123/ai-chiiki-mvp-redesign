import { parseSupplyPatch } from "../../src/lib/validate.js";
import { requireOwnSupply, requireRole } from "../../server/auth.js";
import { handle, json, readJson } from "../../server/http.js";
import { repo } from "../../server/repo.js";

export const CONFLICT_MESSAGE = "情報が更新されています。最新情報を読み込み直してください";

// 生産者本人の供給の数量変更・公開停止／再開。削除はしない（公開停止は published=false、数量0とは別状態）。
// 画面で開いた時点の version と DB の version が違えば上書きせず 409。成功時は version を +1。
export const PATCH = handle(async (request) => {
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "供給が見つかりません" }, 404);
  const own = await requireOwnSupply(g.user, id);
  if (!own.ok) return own.response;

  const parsed = parseSupplyPatch(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { version, ...data } = parsed.value;

  const before = await repo.getSupply(id);
  if (!before) return json({ error: "供給が見つかりません" }, 404);
  if (before.version !== version) return json({ error: CONFLICT_MESSAGE, supply: before }, 409);
  const supply = await repo.updateSupplyIfVersion(id, version, data);
  if (!supply) return json({ error: CONFLICT_MESSAGE, supply: await repo.getSupply(id) }, 409);
  return json({ supply, before: { availableKg: before.availableKg, published: before.published } });
});
