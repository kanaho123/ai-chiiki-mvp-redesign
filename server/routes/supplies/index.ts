import { PREFECTURES } from "../../../src/lib/constants.js";
import { findItemByName } from "../../../src/lib/items.js";
import { appMode } from "../../app-mode.js";
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
  const { itemName, ...input } = parsed.value;

  const [slots, items] = await Promise.all([repo.producerSlots(producer.id), repo.itemsWithVarieties()]);
  if (!slots.some((s) => s.id === input.slotId)) return json({ error: "参加登録している受渡枠から選択してください" }, 400);
  // 品目名で入力されたとき：同じ品目（照合の鍵が同じ）があればそれを使い、なければ一般向けの環境だけ新しく作る。品種は「指定なし」
  let itemId = input.itemId, varietyId = input.varietyId;
  if (!itemId && itemName) {
    const known = findItemByName(itemName, items);
    if (!known) {
      if (appMode() !== "general") return json({ error: "登録済みの品目から選んでください" }, 400);
      // 品目・品種・出品は1つの transaction（出品が作れなければ品目も残らない）
      const { itemId: _i, varietyId: _v, ...rest } = input;
      const supply = await repo.createSupplyWithNewItem(itemName, { ...rest, producerId: producer.id });
      if (!supply) return json({ error: "同じ品目・受渡枠の供給がすでにあります。数量の変更をご利用ください" }, 409);
      return json({ supply }, 201);
    }
    const item = known;
    const plain = item.varieties.find((v) => v.name === "指定なし") ?? (item.varieties.length === 1 ? item.varieties[0] : null);
    if (!plain) return json({ error: "品種を選んでください" }, 400);
    itemId = item.id; varietyId = plain.id;
  }
  const item = items.find((i) => i.id === itemId) ?? (itemId ? { id: itemId, varieties: [{ id: varietyId! }] } : null);
  if (!itemId || !varietyId || !item || !item.varieties.some((v) => v.id === varietyId)) return json({ error: "品目・品種を選び直してください" }, 400);

  const supply = await repo.createSupply({ ...input, itemId, varietyId, producerId: producer.id });
  if (!supply) return json({ error: "同じ品目・受渡枠の供給がすでにあります。数量の変更をご利用ください" }, 409);
  return json({ supply }, 201);
});
