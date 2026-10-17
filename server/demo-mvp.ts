import { hashPassword } from "./auth.js";
import type { PrismaClient } from "./generated/prisma/client.js";

// 仕様書 8.1 のデモ設定（人物・農園・在庫・拠点はすべて架空）。
// 新モデルのテーブルを空にしてから固定 ID で入れ直すので、何度実行しても同じ初期状態に戻る。
// 呼び出し側で assertDemoDatabase() を必ず先に実行すること。
// デモ用ユーザーのパスワードは環境変数 DEMO_LOGIN_PASSWORD から作る（ソースに書かない。DB には scrypt ハッシュだけ保存）。

const jst = (s: string) => new Date(`${s}+09:00`);

export const DEMO_MVP = {
  restaurant: { id: "demo-user-r", loginId: "demo-r", displayName: "飲食店R（架空）" },
  item: { id: "demo-item-tomato", name: "トマト" },
  variety: { id: "demo-variety-t", name: "デモ品種T" },
  places: [
    { id: "demo-place-p", name: "受渡拠点P（架空）", address: "大阪府内（デモ用の架空拠点）" },
    { id: "demo-place-q", name: "受渡拠点Q（架空）", address: "大阪府内（デモ用の架空拠点・Pとは別）" },
  ],
  // G-P: A・B・C が参加。G-Q: D 用の別拠点（P とは組み合わせない）
  slots: [
    { id: "demo-slot-gp", placeId: "demo-place-p", label: "G-P" },
    { id: "demo-slot-gq", placeId: "demo-place-q", label: "G-Q" },
  ],
  producers: [
    // 連絡先は明らかに架空の値（000 で始まる番号・example.invalid）。デモで承認後に開示する初期値で、reset-demo で毎回この値へ戻る
    { key: "a", farmName: "A農園", priorTrade: true, availableKg: 10, priceYenPerKg: 600, published: true, slotId: "demo-slot-gp", contactPhone: "000-0000-0001", contactEmail: "a-farm@example.invalid" },
    { key: "b", farmName: "B農園", priorTrade: false, availableKg: 5, priceYenPerKg: 550, published: true, slotId: "demo-slot-gp", contactPhone: "000-0000-0002", contactEmail: "b-farm@example.invalid" },
    { key: "c", farmName: "C農園", priorTrade: false, availableKg: 0, priceYenPerKg: 500, published: false, slotId: "demo-slot-gp", contactPhone: "000-0000-0003", contactEmail: "c-farm@example.invalid" },
    { key: "d", farmName: "D農園", priorTrade: false, availableKg: 10, priceYenPerKg: 300, published: true, slotId: "demo-slot-gq", contactPhone: "000-0000-0004", contactEmail: "d-farm@example.invalid" },
  ],
} as const;

// 両枠とも 2026/10/23 10:00〜11:00 JST、確認締切 10/22 17:00 JST、固定受渡費800円、最大20kg、条件確認済み
const SLOT_COMMON = {
  startAt: jst("2026-10-23T10:00:00"),
  endAt: jst("2026-10-23T11:00:00"),
  confirmDeadlineAt: jst("2026-10-22T17:00:00"),
  feeYen: 800,
  feeConfirmed: true,
  maxKg: 20,
  conditionsConfirmed: true,
};

export async function seedMvpDemo(prisma: PrismaClient, password = process.env.DEMO_LOGIN_PASSWORD) {
  const d = DEMO_MVP;
  if (!password) console.warn("DEMO_LOGIN_PASSWORD が未設定のため、デモ用ユーザーはログインできない状態で作成します");
  // ユーザーごとに別のソルトでハッシュ化（トランザクションの外で先に計算する）
  const keys = ["r", ...d.producers.map((p) => p.key)];
  const hashes = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, password ? await hashPassword(password) : null] as const)));
  await prisma.$transaction(async (tx) => {
    // 子テーブルから順に空にする（デモ用 DB では新モデルのテーブルはすべてデモデータ）
    await tx.approvalRequest.deleteMany();
    await tx.supply.deleteMany();
    await tx.slotParticipant.deleteMany();
    await tx.relationship.deleteMany();
    await tx.handoverSlot.deleteMany();
    await tx.place.deleteMany();
    await tx.producer.deleteMany();
    await tx.user.deleteMany();
    await tx.variety.deleteMany();
    await tx.item.deleteMany();

    await tx.item.create({ data: d.item });
    await tx.variety.create({ data: { ...d.variety, itemId: d.item.id } });
    await tx.user.create({ data: { ...d.restaurant, role: "restaurant", passwordHash: hashes.r } });
    await tx.place.createMany({ data: [...d.places] });
    await tx.handoverSlot.createMany({ data: d.slots.map((s) => ({ ...s, ...SLOT_COMMON })) });

    const ps = d.producers.map((p) => ({ ...p, userId: `demo-user-${p.key}`, producerId: `demo-producer-${p.key}` }));
    await tx.user.createMany({
      data: ps.map((p) => ({ id: p.userId, loginId: `demo-${p.key}`, passwordHash: hashes[p.key], role: "producer" as const, displayName: `${p.farmName}（架空）` })),
    });
    await tx.producer.createMany({ data: ps.map((p) => ({ id: p.producerId, ownerUserId: p.userId, farmName: p.farmName, originPrefecture: "大阪府", contactPhone: p.contactPhone, contactEmail: p.contactEmail })) });
    await tx.relationship.createMany({ data: ps.map((p) => ({ restaurantUserId: d.restaurant.id, producerId: p.producerId, priorTrade: p.priorTrade })) });
    await tx.slotParticipant.createMany({ data: ps.map((p) => ({ slotId: p.slotId, producerId: p.producerId, confirmed: true })) });
    await tx.supply.createMany({
      data: ps.map((p) => ({
        id: `demo-supply-${p.key}`,
        producerId: p.producerId,
        itemId: d.item.id,
        varietyId: d.variety.id,
        grade: "regular" as const,
        irregularReason: null,
        originPrefecture: "大阪府",
        availableKg: p.availableKg,
        priceYenPerKg: p.priceYenPerKg,
        minKg: 1,
        slotId: p.slotId,
        published: p.published,
        version: 1,
      })),
    });
  }, { timeout: 30_000 }); // Neon（米国リージョン）への往復が多いため既定の5秒では足りない
}
