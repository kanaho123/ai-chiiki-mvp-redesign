-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('restaurant', 'producer');

-- CreateEnum
CREATE TYPE "SupplyGrade" AS ENUM ('regular', 'irregular');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producers" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "farmName" TEXT NOT NULL,
    "originPrefecture" TEXT NOT NULL,

    CONSTRAINT "producers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationships" (
    "restaurantUserId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "priorTrade" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("restaurantUserId","producerId")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "varieties" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "varieties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_slots" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "confirmDeadlineAt" TIMESTAMP(3) NOT NULL,
    "feeYen" INTEGER NOT NULL,
    "feeConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "maxKg" INTEGER NOT NULL,
    "conditionsConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "handover_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_participants" (
    "slotId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "slot_participants_pkey" PRIMARY KEY ("slotId","producerId")
);

-- CreateTable
CREATE TABLE "supplies" (
    "id" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "varietyId" TEXT NOT NULL,
    "grade" "SupplyGrade" NOT NULL DEFAULT 'regular',
    "irregularReason" TEXT,
    "originPrefecture" TEXT NOT NULL,
    "availableKg" INTEGER NOT NULL,
    "priceYenPerKg" INTEGER NOT NULL,
    "minKg" INTEGER NOT NULL DEFAULT 1,
    "slotId" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "supplies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producers_ownerUserId_idx" ON "producers"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "items_name_key" ON "items"("name");

-- CreateIndex
CREATE UNIQUE INDEX "varieties_itemId_name_key" ON "varieties"("itemId", "name");

-- CreateIndex
CREATE INDEX "handover_slots_placeId_idx" ON "handover_slots"("placeId");

-- CreateIndex
CREATE INDEX "supplies_slotId_idx" ON "supplies"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "supplies_producerId_itemId_slotId_key" ON "supplies"("producerId", "itemId", "slotId");

-- AddForeignKey
ALTER TABLE "producers" ADD CONSTRAINT "producers_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_restaurantUserId_fkey" FOREIGN KEY ("restaurantUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "varieties" ADD CONSTRAINT "varieties_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_slots" ADD CONSTRAINT "handover_slots_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_participants" ADD CONSTRAINT "slot_participants_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "handover_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_participants" ADD CONSTRAINT "slot_participants_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_varietyId_fkey" FOREIGN KEY ("varietyId") REFERENCES "varieties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "handover_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
