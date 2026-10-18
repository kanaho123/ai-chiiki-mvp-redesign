import { PREFECTURES } from "../../../src/lib/constants.js";
import { parseSupplyInput } from "../../../src/lib/validate.js";
import { requireRole } from "../../auth.js";
import { handle, json, readJson } from "../../http.js";
import { repo } from "../../repo.js";
import { refillSlotsIfDue } from "../../slot-refill.js";

// 生産者本人の供給一覧（他の生産者の供給は返さない）と、登録に使う選択肢
export const GET = handle(async (request) => {
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  await refillSlotsIfDue(); // これからの受渡の回が足りなければ補充（一般向けの環境だけ）
  const producer = g.user.producer;
  if (!producer) return json({ error: "生産者情報が登録されていません" }, 403);
  const [supplies, slots, items] = await Promise.all([repo.listOwnSupplies(producer.id), repo.producerSlots(producer.id), repo.itemsWithVarieties()]);
  return json({ producer, supplies, slots, items, prefectures: PREFECTURES });
});

// 新しい供給。生産者はログイン中の本人に自動で紐付け、受渡枠は本人が参加登録している枠からだけ選べる
export const POST = handle(async (request) => {
  const g = await requireRole(request, "producer");
  if (!g.ok) return g.response;
  const producer = g.user.producer;
  if (!producer) return json({ error: "生産者情報が登録されていません" }, 403);
  const parsed = parseSupplyInput(await readJson(request));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const input = parsed.value;

  const [slots, items] = await Promise.all([repo.producerSlots(producer.id), repo.itemsWithVarieties()]);
  if (!slots.some((s) => s.id === input.slotId)) return json({ error: "参加登録している受渡枠から選択してください" }, 400);
  const item = items.find((i) => i.id === input.itemId);
  if (!item || !item.varieties.some((v) => v.id === input.varietyId)) return json({ error: "品目・品種を選び直してください" }, 400);

  const supply = await repo.createSupply({ ...input, producerId: producer.id });
  if (!supply) return json({ error: "同じ品目・受渡枠の供給がすでにあります。数量の変更をご利用ください" }, 409);
  return json({ supply }, 201);
});
