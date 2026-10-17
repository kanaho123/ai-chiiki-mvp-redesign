ALTER TABLE "producers" ADD COLUMN "contactPhone" TEXT, ADD COLUMN "contactEmail" TEXT;
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');
CREATE TABLE "approval_requests" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "producerId" TEXT NOT NULL,
  "supplyId" TEXT NOT NULL,
  "planFingerprint" TEXT NOT NULL,
  "planVersion" TEXT NOT NULL,
  "planRequest" JSONB NOT NULL,
  "itemName" TEXT NOT NULL,
  "quantityKg" INTEGER NOT NULL,
  "priceYenPerKg" INTEGER NOT NULL,
  "subtotalYen" INTEGER NOT NULL,
  "pickupStartAt" TIMESTAMP(3) NOT NULL,
  "pickupEndAt" TIMESTAMP(3) NOT NULL,
  "pickupPlace" TEXT NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "approval_requests_quantity_check" CHECK ("quantityKg" > 0 AND "priceYenPerKg" > 0 AND "subtotalYen" = "quantityKg" * "priceYenPerKg"),
  CONSTRAINT "approval_requests_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approval_requests_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "approval_requests_restaurantId_supplyId_planFingerprint_key" ON "approval_requests"("restaurantId", "supplyId", "planFingerprint");
CREATE INDEX "approval_requests_producerId_createdAt_idx" ON "approval_requests"("producerId", "createdAt");
CREATE INDEX "approval_requests_restaurantId_planFingerprint_idx" ON "approval_requests"("restaurantId", "planFingerprint");
