import type { PrismaClient } from "./generated/prisma/client.js";
import type { ProducerProfile, RestaurantProfile } from "../src/lib/onboarding.js";

// 一般ユーザーの初回登録（オンボーディング）の完了。
// プロフィールの作成・関連データ・User.onboardedAt（と表示名の同期）を1つの transaction で行い、
// 途中で失敗したら何も残さない（onboardedAt だけ付いた状態を作らない）。
// 通信の再送：すでに同じロールのプロフィールがあって登録済みなら「完了済み」として成功を返す。

export class OnboardingProblem extends Error {
  constructor(readonly status: number, message: string, readonly field?: string) {
    super(message);
    this.name = "OnboardingProblem";
  }
}
export type CompleteResult = { status: "completed" | "already-completed" };
type Db = Pick<PrismaClient, "$transaction">;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// DB との往復が遅いとき（接続先が遠い・混んでいる）でも、途中で打ち切られないように余裕をもたせる（既定は5秒）
export const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

const INCONSISTENT = "登録情報に不整合があるため完了できませんでした。お手数ですが運営までお問い合わせください";

/** 本人の状態を確かめる。再送なら "already"、作ってよければ null */
async function precheck(tx: Tx, userId: string, role: "restaurant" | "producer"): Promise<"already" | null> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { role: true, onboardedAt: true, restaurant: { select: { id: true } }, producer: { select: { id: true } } } });
  if (!u) throw new OnboardingProblem(401, "ログインしてください");
  if (u.role !== role) throw new OnboardingProblem(403, "この操作を行う権限がありません");
  const own = role === "restaurant" ? u.restaurant : u.producer;
  const other = role === "restaurant" ? u.producer : u.restaurant;
  if (other) throw new OnboardingProblem(409, INCONSISTENT);
  if (u.onboardedAt) {
    if (own) return "already";
    throw new OnboardingProblem(409, INCONSISTENT);
  }
  if (own) throw new OnboardingProblem(409, INCONSISTENT); // 登録前なのにプロフィールだけある（通常は起きない）
  return null;
}

/** 登録済みにする。同時に2回送られても、片方だけが成功する（もう片方は transaction ごと取り消し） */
async function markOnboarded(tx: Tx, userId: string, displayName: string, now: Date) {
  const r = await tx.user.updateMany({ where: { id: userId, onboardedAt: null }, data: { onboardedAt: now, displayName } });
  if (r.count !== 1) throw new OnboardingProblem(409, "登録の処理が重なりました。画面を再読み込みしてください");
}

/** 一意制約の衝突など（同時の再送）で失敗したときは、もう一度だけ状態を見て、完了済みなら成功にする */
async function settle(db: Db, userId: string, role: "restaurant" | "producer", run: () => Promise<CompleteResult>): Promise<CompleteResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof OnboardingProblem && e.status !== 409) throw e;
    const again = await db.$transaction((tx) => precheck(tx, userId, role)).catch(() => null);
    if (again === "already") return { status: "already-completed" };
    throw e;
  }
}

export async function completeRestaurantOnboarding(db: Db, userId: string, p: RestaurantProfile, now: Date): Promise<CompleteResult> {
  return settle(db, userId, "restaurant", () => db.$transaction(async (tx) => {
    if ((await precheck(tx, userId, "restaurant")) === "already") return { status: "already-completed" } as const;
    await tx.restaurant.create({
      data: {
        ownerUserId: userId, name: p.name, businessType: p.businessType, businessTypeOther: p.businessTypeOther,
        prefecture: p.prefecture, city: p.city, address: p.address, phone: p.phone,
        purchaseFrequency: p.purchaseFrequency, purchaseVolume: p.purchaseVolume, irregularPolicy: p.irregularPolicy, firstTimePolicy: p.firstTimePolicy,
        pickupTimes: p.pickupTimes, priorities: p.priorities,
      },
    });
    // 表示名は既存の画面との互換用。プロフィールの正は Restaurant.name
    await markOnboarded(tx, userId, p.name, now);
    return { status: "completed" } as const;
  }, TX_OPTIONS));
}

export async function completeProducerOnboarding(db: Db, userId: string, p: ProducerProfile, now: Date): Promise<CompleteResult> {
  return settle(db, userId, "producer", () => db.$transaction(async (tx) => {
    if ((await precheck(tx, userId, "producer")) === "already") return { status: "already-completed" } as const;
    // 品目はマスタにあるものだけ、受渡枠は運営が有効にしている定期枠だけ（active=false は新しく参加できない）
    const items = await tx.item.findMany({ where: { id: { in: p.itemIds } }, select: { id: true } });
    if (items.length !== p.itemIds.length) throw new OnboardingProblem(400, "選べない作物が含まれています。選び直してください", "itemIds");
    const series = await tx.slotSeries.findMany({ where: { id: { in: p.seriesIds }, active: true }, select: { id: true } });
    if (series.length !== p.seriesIds.length) throw new OnboardingProblem(400, "選べない受渡枠が含まれています。選び直してください", "seriesIds");

    const producer = await tx.producer.create({
      data: {
        ownerUserId: userId, farmName: p.farmName, producerName: p.producerName, originPrefecture: p.prefecture, city: p.city,
        otherCrops: p.otherCrops, productionStyle: p.productionStyle, salesChannels: p.salesChannels, directTradeExperience: p.directTradeExperience,
        capabilities: p.capabilities, contactPhone: p.contactPhone, contactEmail: p.contactEmail,
      },
      select: { id: true },
    });
    await tx.producerItem.createMany({ data: p.itemIds.map((itemId) => ({ producerId: producer.id, itemId })) });
    await tx.slotSeriesParticipant.createMany({ data: p.seriesIds.map((seriesId) => ({ seriesId, producerId: producer.id })) });
    // すでに作られている、これからの受渡の回にも参加者として加える（運営の seed と同じ扱い）
    const slots = await tx.handoverSlot.findMany({ where: { seriesId: { in: p.seriesIds }, confirmDeadlineAt: { gt: now } }, select: { id: true } });
    if (slots.length > 0) {
      await tx.slotParticipant.createMany({ data: slots.map((s) => ({ slotId: s.id, producerId: producer.id, confirmed: true })), skipDuplicates: true });
    }
    await markOnboarded(tx, userId, p.farmName, now);
    return { status: "completed" } as const;
  }, TX_OPTIONS));
}

/** 生産者の登録画面で使うマスタ（品目・有効な定期の受渡枠と場所）。内部の設定値は返さない */
export async function producerOnboardingMaster(db: Pick<PrismaClient, "item" | "slotSeries">) {
  const [items, series] = await Promise.all([
    db.item.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.slotSeries.findMany({
      where: { active: true },
      select: { id: true, weekday: true, startTime: true, endTime: true, feeYen: true, place: { select: { name: true, address: true } } },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    }),
  ]);
  return {
    items,
    series: series.map((s) => ({ id: s.id, placeName: s.place.name, placeAddress: s.place.address, weekday: s.weekday, startTime: s.startTime, endTime: s.endTime, feeYen: s.feeYen })),
  };
}
