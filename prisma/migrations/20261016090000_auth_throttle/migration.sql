-- CreateTable
CREATE TABLE "auth_throttles" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("key")
);

