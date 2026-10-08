-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "boardColumnId" TEXT,
ADD COLUMN     "boardOrder" DOUBLE PRECISION NOT NULL DEFAULT extract(epoch from now());

-- CreateTable
CREATE TABLE "task_board_columns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isEntrance" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_board_columns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_board_columns_organizationId_order_idx" ON "task_board_columns"("organizationId", "order");

-- CreateIndex
CREATE INDEX "tasks_organizationId_boardColumnId_idx" ON "tasks"("organizationId", "boardColumnId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_boardColumnId_fkey" FOREIGN KEY ("boardColumnId") REFERENCES "task_board_columns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

