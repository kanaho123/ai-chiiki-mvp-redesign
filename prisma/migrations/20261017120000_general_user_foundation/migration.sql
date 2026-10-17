-- CreateEnum
CREATE TYPE "ProductionStyle" AS ENUM ('many_small', 'specialized', 'seasonal', 'other');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('market', 'ja', 'direct_store', 'restaurant', 'ec', 'other');

-- CreateEnum
CREATE TYPE "DirectTradeExperience" AS ENUM ('often', 'sometimes', 'rarely', 'never');

-- CreateEnum
CREATE TYPE "ProducerCapability" AS ENUM ('small_lot', 'irregular', 'surplus', 'direct_talk');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('japanese', 'izakaya', 'italian', 'french', 'cafe', 'bakery', 'chinese', 'western', 'other');

-- CreateEnum
CREATE TYPE "PurchaseFrequency" AS ENUM ('almost_daily', 'few_times_weekly', 'weekly', 'as_needed');

-- CreateEnum
CREATE TYPE "PurchaseVolume" AS ENUM ('small', 'kg5_10', 'kg10_30', 'kg30_plus');

-- CreateEnum
CREATE TYPE "IrregularPolicy" AS ENUM ('welcome', 'depends', 'avoid');

-- CreateEnum
CREATE TYPE "FirstTimePolicy" AS ENUM ('include', 'prefer_known');

-- CreateEnum
CREATE TYPE "PickupTime" AS ENUM ('early_morning', 'morning', 'afternoon', 'evening', 'any');

-- CreateEnum
CREATE TYPE "PurchasePriority" AS ENUM ('local', 'freshness', 'price', 'stable_supply', 'small_lots', 'use_irregular', 'rare_items', 'direct_connection');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "legalAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "privacyVersion" TEXT,
ADD COLUMN     "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "producers" ADD COLUMN     "capabilities" "ProducerCapability"[] DEFAULT ARRAY[]::"ProducerCapability"[],
ADD COLUMN     "city" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "directTradeExperience" "DirectTradeExperience",
ADD COLUMN     "otherCrops" TEXT,
ADD COLUMN     "producerName" TEXT,
ADD COLUMN     "productionStyle" "ProductionStyle",
ADD COLUMN     "salesChannels" "SalesChannel"[] DEFAULT ARRAY[]::"SalesChannel"[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "handover_slots" ADD COLUMN     "seriesId" TEXT;

-- CreateTable
CREATE TABLE "producer_items" (
    "producerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "producer_items_pkey" PRIMARY KEY ("producerId","itemId")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "businessTypeOther" TEXT,
    "prefecture" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "purchaseFrequency" "PurchaseFrequency",
    "purchaseVolume" "PurchaseVolume",
    "irregularPolicy" "IrregularPolicy",
    "firstTimePolicy" "FirstTimePolicy",
    "pickupTimes" "PickupTime"[] DEFAULT ARRAY[]::"PickupTime"[],
    "priorities" "PurchasePriority"[] DEFAULT ARRAY[]::"PurchasePriority"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_series" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "deadlineHours" INTEGER NOT NULL,
    "feeYen" INTEGER NOT NULL,
    "maxKg" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "slot_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_series_participants" (
    "seriesId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_series_participants_pkey" PRIMARY KEY ("seriesId","producerId")
);

-- CreateIndex
CREATE INDEX "producer_items_itemId_idx" ON "producer_items"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_ownerUserId_key" ON "restaurants"("ownerUserId");

-- CreateIndex
CREATE INDEX "slot_series_placeId_idx" ON "slot_series"("placeId");

-- CreateIndex
CREATE INDEX "slot_series_participants_producerId_idx" ON "slot_series_participants"("producerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "producers_ownerUserId_key" ON "producers"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "handover_slots_seriesId_startAt_key" ON "handover_slots"("seriesId", "startAt");

-- AddForeignKey
ALTER TABLE "producer_items" ADD CONSTRAINT "producer_items_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_items" ADD CONSTRAINT "producer_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_slots" ADD CONSTRAINT "handover_slots_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "slot_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_series" ADD CONSTRAINT "slot_series_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_series_participants" ADD CONSTRAINT "slot_series_participants_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "slot_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_series_participants" ADD CONSTRAINT "slot_series_participants_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

