-- CreateEnum
CREATE TYPE "PlaceKind" AS ENUM ('direct_store', 'collection_point', 'shipping_destination', 'farm', 'other');

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "kind" "PlaceKind",
ADD COLUMN     "note" TEXT,
ADD COLUMN     "ownerProducerId" TEXT;

-- CreateIndex
CREATE INDEX "places_ownerProducerId_idx" ON "places"("ownerProducerId");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_ownerProducerId_fkey" FOREIGN KEY ("ownerProducerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

