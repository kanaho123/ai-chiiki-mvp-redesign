-- CreateTable
CREATE TABLE "Producer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Producer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "variety" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "availableDate" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "irregularReason" TEXT,
    "handoverPlace" TEXT NOT NULL,
    "handoverStart" TEXT NOT NULL,
    "handoverEnd" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "handoverFee" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_item_idx" ON "Listing"("item");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "Producer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
