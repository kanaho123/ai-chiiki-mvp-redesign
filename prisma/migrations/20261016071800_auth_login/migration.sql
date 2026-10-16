-- AlterTable
ALTER TABLE "users" ADD COLUMN     "loginId" TEXT,
ADD COLUMN     "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_loginId_key" ON "users"("loginId");

