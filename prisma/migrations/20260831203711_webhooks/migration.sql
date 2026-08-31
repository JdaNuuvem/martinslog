-- CreateTable
CREATE TABLE "webhook_apps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventos" JSONB NOT NULL,
    "segredo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhookAppId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "statusHttp" INTEGER,
    "erro" TEXT,
    "proximaTentativaEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_apps_userId_ativo_idx" ON "webhook_apps"("userId", "ativo");

-- CreateIndex
CREATE INDEX "webhook_deliveries_proximaTentativaEm_entregueEm_idx" ON "webhook_deliveries"("proximaTentativaEm", "entregueEm");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookAppId_criadoEm_idx" ON "webhook_deliveries"("webhookAppId", "criadoEm");

-- AddForeignKey
ALTER TABLE "webhook_apps" ADD CONSTRAINT "webhook_apps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookAppId_fkey" FOREIGN KEY ("webhookAppId") REFERENCES "webhook_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
