-- CreateEnum
CREATE TYPE "AmbienteApiToken" AS ENUM ('SANDBOX', 'PRODUCAO');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "sandbox" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ambiente" "AmbienteApiToken" NOT NULL,
    "ultimoUsoEm" TIMESTAMP(3),
    "revogadoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_userId_idx" ON "api_tokens"("userId");

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
