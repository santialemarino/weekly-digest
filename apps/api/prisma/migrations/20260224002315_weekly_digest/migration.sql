-- CreateTable
CREATE TABLE "Digest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clickupSpaceMap" JSONB NOT NULL,
    "slackChannelGroups" JSONB NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'es',
    "sprintOffset" INTEGER NOT NULL DEFAULT 0,
    "pdfEnabled" BOOLEAN NOT NULL DEFAULT true,
    "anthropicModel" TEXT,
    "anthropicModelSmall" TEXT,
    "autoModel" BOOLEAN NOT NULL DEFAULT true,
    "autoModelThreshold" INTEGER NOT NULL DEFAULT 25,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleCron" TEXT,
    "scheduleTimezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Digest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestOutput" (
    "id" TEXT NOT NULL,
    "digestId" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tone" TEXT NOT NULL DEFAULT 'informal',
    "format" TEXT NOT NULL DEFAULT 'markdown',
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestRun" (
    "id" TEXT NOT NULL,
    "digestId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "sprintPeriod" TEXT,
    "rawDigests" JSONB,
    "tokenUsage" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigestDelivery" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestDelivery_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DigestOutput" ADD CONSTRAINT "DigestOutput_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "Digest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestRun" ADD CONSTRAINT "DigestRun_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "Digest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestDelivery" ADD CONSTRAINT "DigestDelivery_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DigestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
