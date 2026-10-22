-- 生産者の「いつもの受け渡し場所」（場所だけ。曜日・時間は持たない）。追加のみ
-- CreateTable
CREATE TABLE "producer_places" (
    "producerId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producer_places_pkey" PRIMARY KEY ("producerId","placeId")
);

-- CreateIndex
CREATE INDEX "producer_places_placeId_idx" ON "producer_places"("placeId");

-- AddForeignKey
ALTER TABLE "producer_places" ADD CONSTRAINT "producer_places_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producer_places" ADD CONSTRAINT "producer_places_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "places"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
