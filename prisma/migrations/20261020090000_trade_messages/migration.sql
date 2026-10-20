-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "receivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "trade_messages" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trade_messages_approvalRequestId_createdAt_idx" ON "trade_messages"("approvalRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "trade_messages" ADD CONSTRAINT "trade_messages_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_messages" ADD CONSTRAINT "trade_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
