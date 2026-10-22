-- 取引後の評価（trade_reviews）と飲食店の「いつもの農家」（usual_producers）。追加のみ（既存の表・列は変更しない）
-- 外部キーはすべて RESTRICT（相談・利用者・農家を消しても、評価・いつもの農家が黙って消えないように）

-- CreateEnum
CREATE TYPE "TradeRating" AS ENUM ('good', 'bad');

-- CreateTable
CREATE TABLE "trade_reviews" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "reviewerRole" "UserRole" NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "rating" "TradeRating" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usual_producers" (
    "restaurantUserId" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usual_producers_pkey" PRIMARY KEY ("restaurantUserId","producerId")
);

-- CreateIndex
CREATE INDEX "trade_reviews_reviewerUserId_idx" ON "trade_reviews"("reviewerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_reviews_approvalRequestId_reviewerRole_key" ON "trade_reviews"("approvalRequestId", "reviewerRole");

-- CreateIndex
CREATE INDEX "usual_producers_producerId_idx" ON "usual_producers"("producerId");

-- CreateIndex
CREATE INDEX "usual_producers_approvalRequestId_idx" ON "usual_producers"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_reviews" ADD CONSTRAINT "trade_reviews_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usual_producers" ADD CONSTRAINT "usual_producers_restaurantUserId_fkey" FOREIGN KEY ("restaurantUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usual_producers" ADD CONSTRAINT "usual_producers_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "producers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usual_producers" ADD CONSTRAINT "usual_producers_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

