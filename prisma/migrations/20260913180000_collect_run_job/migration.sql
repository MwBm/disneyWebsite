-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('collect', 'train', 'archive');

-- AlterTable
ALTER TABLE "CollectRun" ADD COLUMN     "job" "JobKind" NOT NULL DEFAULT 'collect';

-- Backfill: before this migration train.py logged into CollectRun as well.
-- On production (checked 2026-09-13) every successful collect run wrote 50-59
-- rows and every successful train run 65,280-75,120, with nothing in between,
-- so row count identifies successful train runs exactly. Without this the
-- forecast staleness check would see no train run at all right after deploy.
-- Failed runs logged 0-59 rows under either job and cannot be told apart;
-- they stay 'collect'.
UPDATE "CollectRun" SET "job" = 'train' WHERE "success" AND "rowsUpserted" >= 1000;
