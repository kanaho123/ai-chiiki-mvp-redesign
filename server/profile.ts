import type { PrismaClient } from "./generated/prisma/client.js";
import type { ProducerForm, ProducerProfile, RestaurantForm, RestaurantProfile } from "../src/lib/onboarding.js";
import { OnboardingProblem, TX_OPTIONS } from "./onboarding.js";

// マイページ：本人のプロフィールの表示と更新（一般ユーザー向け）。
// ・更新先は必ずログイン中の本人のプロフィール（送られた ID・ownerUserId は使わない）
// ・入力の確認は初回登録と同じ規則（src/lib/onboarding.ts）。品目・受渡枠の実在確認はここで DB を見る
// ・表示名（User.displayName）は既存の画面との互換用に同期する。正は Restaurant.name / Producer.farmName
// ・受渡枠を外しても、すでに予定に入っている受渡の回の参加はそのまま残す（自動で取り消さない）。
//   新しく選べるのは運営が有効にしている定期枠だけ。止められた定期枠（active=false）でも、すでに参加しているものは残せる

type Db = Pick<PrismaClient, "$transaction" | "restaurant" | "producer" | "item" | "slotSeries">;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
const s = (v: string | null | undefined) => v ?? "";

export type SeriesOption = { id: string; placeName: string; placeAddress: string; placeKind: string | null; weekday: number; startTime: string; endTime: string; feeYen: number; active: boolean };
export type ProfileView =
  | { role: "restaurant"; profile: RestaurantForm }
  | { role: "producer"; profile: ProducerForm; items: { id: string; name: string }[]; series: SeriesOption[] };

export async function loadProfile(db: Db, user: { id: string; role: "restaurant" | "producer" }): Promise<ProfileView | null> {
  if (user.role === "restaurant") {
    const r = await db.restaurant.findUnique({ where: { ownerUserId: user.id } });
    if (!r) return null;
    return {
      role: "restaurant",
      profile: {
        name: r.name, businessType: r.businessType, businessTypeOther: s(r.businessTypeOther), prefecture: r.prefecture, city: r.city,
        address: s(r.address), phone: s(r.phone), purchaseFrequency: r.purchaseFrequency ?? "", purchaseVolume: r.purchaseVolume ?? "",
        irregularPolicy: r.irregularPolicy ?? "", firstTimePolicy: r.firstTimePolicy ?? "", pickupTimes: r.pickupTimes, priorities: r.priorities,
      },
    };
  }
  const p = await db.producer.findUnique({
    where: { ownerUserId: user.id },
    include: { mainItems: { select: { itemId: true } }, seriesMemberships: { select: { seriesId: true } } },
  });
  if (!p) return null;
  const joined = p.seriesMemberships.map((m) => m.seriesId);
  const [items, series] = await Promise.all([
    db.item.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.slotSeries.findMany({
      where: { OR: [{ active: true }, { id: { in: joined } }] },
      select: { id: true, weekday: true, startTime: true, endTime: true, feeYen: true, active: true, place: { select: { name: true, address: true, kind: true } } },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    }),
  ]);
  return {
    role: "producer",
    profile: {
      farmName: p.farmName, producerName: s(p.producerName), prefecture: p.originPrefecture, city: s(p.city),
      itemIds: p.mainItems.map((m) => m.itemId), otherCrops: s(p.otherCrops), productionStyle: p.productionStyle ?? "",
      salesChannels: p.salesChannels, directTradeExperience: p.directTradeExperience ?? "", capabilities: p.capabilities,
      seriesIds: joined, contactPhone: s(p.contactPhone), contactEmail: s(p.contactEmail),
    },
    items,
    series: series.map((x) => ({ id: x.id, placeName: x.place.name, placeAddress: x.place.address, placeKind: x.place.kind, weekday: x.weekday, startTime: x.startTime, endTime: x.endTime, feeYen: x.feeYen, active: x.active })),
  };
}

const NO_PROFILE = () => new OnboardingProblem(404, "プロフィールが見つかりません");

export async function updateRestaurantProfile(db: Db, userId: string, p: RestaurantProfile) {
  await db.$transaction(async (tx: Tx) => {
    const r = await tx.restaurant.updateMany({
      where: { ownerUserId: userId },
      data: {
        name: p.name, businessType: p.businessType, businessTypeOther: p.businessTypeOther, prefecture: p.prefecture, city: p.city,
        address: p.address, phone: p.phone, purchaseFrequency: p.purchaseFrequency, purchaseVolume: p.purchaseVolume,
        irregularPolicy: p.irregularPolicy, firstTimePolicy: p.firstTimePolicy, pickupTimes: p.pickupTimes, priorities: p.priorities,
      },
    });
    if (r.count !== 1) throw NO_PROFILE();
    await tx.user.update({ where: { id: userId }, data: { displayName: p.name } });
  }, TX_OPTIONS);
}

export async function updateProducerProfile(db: Db, userId: string, p: ProducerProfile, now: Date) {
  await db.$transaction(async (tx: Tx) => {
    const producer = await tx.producer.findUnique({ where: { ownerUserId: userId }, select: { id: true, seriesMemberships: { select: { seriesId: true } } } });
    if (!producer) throw NO_PROFILE();
    const joined = new Set(producer.seriesMemberships.map((m) => m.seriesId));
    const items = await tx.item.findMany({ where: { id: { in: p.itemIds } }, select: { id: true } });
    if (items.length !== p.itemIds.length) throw new OnboardingProblem(400, "選べない作物が含まれています。選び直してください", "itemIds");
    const series = await tx.slotSeries.findMany({ where: { id: { in: p.seriesIds } }, select: { id: true, active: true } });
    const allowed = series.filter((x) => x.active || joined.has(x.id));
    if (allowed.length !== p.seriesIds.length) throw new OnboardingProblem(400, "選べない受渡枠が含まれています。選び直してください", "seriesIds");

    await tx.producer.update({
      where: { id: producer.id },
      data: {
        farmName: p.farmName, producerName: p.producerName, originPrefecture: p.prefecture, city: p.city, otherCrops: p.otherCrops,
        productionStyle: p.productionStyle, salesChannels: p.salesChannels, directTradeExperience: p.directTradeExperience,
        capabilities: p.capabilities, contactPhone: p.contactPhone, contactEmail: p.contactEmail,
      },
    });
    await tx.producerItem.deleteMany({ where: { producerId: producer.id } });
    await tx.producerItem.createMany({ data: p.itemIds.map((itemId) => ({ producerId: producer.id, itemId })) });

    const added = p.seriesIds.filter((id) => !joined.has(id));
    const removed = [...joined].filter((id) => !p.seriesIds.includes(id));
    if (removed.length > 0) await tx.slotSeriesParticipant.deleteMany({ where: { producerId: producer.id, seriesId: { in: removed } } });
    if (added.length > 0) {
      await tx.slotSeriesParticipant.createMany({ data: added.map((seriesId) => ({ seriesId, producerId: producer.id })), skipDuplicates: true });
      const slots = await tx.handoverSlot.findMany({ where: { seriesId: { in: added }, confirmDeadlineAt: { gt: now } }, select: { id: true } });
      if (slots.length > 0) await tx.slotParticipant.createMany({ data: slots.map((x) => ({ slotId: x.id, producerId: producer.id, confirmed: true })), skipDuplicates: true });
    }
    await tx.user.update({ where: { id: userId }, data: { displayName: p.farmName } });
  }, TX_OPTIONS);
}
