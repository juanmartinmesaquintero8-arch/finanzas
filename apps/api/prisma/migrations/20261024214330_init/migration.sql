-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'DIGITAL', 'SAVINGS', 'CREDIT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('ONCE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "initial_balance" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "category" VARCHAR(60),
    "account_id" UUID,
    "from_account_id" UUID,
    "to_account_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_expenses" (
    "id" UUID NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "account_id" UUID NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "settled_through" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transactions_account_id_date_idx" ON "transactions"("account_id", "date");

-- CreateIndex
CREATE INDEX "transactions_from_account_id_idx" ON "transactions"("from_account_id");

-- CreateIndex
CREATE INDEX "transactions_to_account_id_idx" ON "transactions"("to_account_id");

-- CreateIndex
CREATE INDEX "transactions_date_id_idx" ON "transactions"("date" DESC, "id");

-- CreateIndex
CREATE INDEX "scheduled_expenses_account_id_idx" ON "scheduled_expenses"("account_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariantes del dominio reforzadas en BD (CLAUDE.md §3)
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shape" CHECK (
  ("type" IN ('INCOME', 'EXPENSE') AND "account_id" IS NOT NULL AND "from_account_id" IS NULL AND "to_account_id" IS NULL)
  OR
  ("type" = 'TRANSFER' AND "account_id" IS NULL AND "from_account_id" IS NOT NULL AND "to_account_id" IS NOT NULL
     AND "from_account_id" <> "to_account_id")
);
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "scheduled_expenses" ADD CONSTRAINT "scheduled_expenses_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
