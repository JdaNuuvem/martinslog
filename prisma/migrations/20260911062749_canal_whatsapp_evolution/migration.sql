-- Canal de WhatsApp por loja: a oficial da Meta e a Evolution convivem.
--
-- NAO mexe nos indices de `pedidos` nem de `mensagem_envios`. O Prisma pede
-- isso toda vez porque nao sabe escrever indice PARCIAL nem NULLS NOT
-- DISTINCT, e acha que faltam. Eles existem, escritos a mao nas migrations
-- 20260906180000 e 20260906190000. Aceitar a sugestao desfaz as duas.

-- CreateEnum
CREATE TYPE "ProvedorWhatsapp" AS ENUM ('META', 'EVOLUTION');

-- AlterTable
ALTER TABLE "perfis" ADD COLUMN     "whatsappProvedor" "ProvedorWhatsapp" NOT NULL DEFAULT 'META';

-- CreateTable
CREATE TABLE "evolution_configs" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "instancia" TEXT NOT NULL,
    "numero" TEXT,
    "conectadoEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evolution_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_recebidas" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "evolutionId" TEXT,
    "de" TEXT NOT NULL,
    "nomeContato" TEXT,
    "texto" TEXT NOT NULL,
    "idExterno" TEXT NOT NULL,
    "recebidaEm" TIMESTAMP(3) NOT NULL,
    "lidaEm" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_recebidas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evolution_configs_perfilId_key" ON "evolution_configs"("perfilId");

-- CreateIndex
CREATE UNIQUE INDEX "evolution_configs_instancia_key" ON "evolution_configs"("instancia");

-- CreateIndex
CREATE UNIQUE INDEX "mensagens_recebidas_idExterno_key" ON "mensagens_recebidas"("idExterno");

-- CreateIndex
CREATE INDEX "mensagens_recebidas_perfilId_recebidaEm_idx" ON "mensagens_recebidas"("perfilId", "recebidaEm");

-- CreateIndex
CREATE INDEX "mensagens_recebidas_perfilId_lidaEm_idx" ON "mensagens_recebidas"("perfilId", "lidaEm");

-- AddForeignKey
ALTER TABLE "evolution_configs" ADD CONSTRAINT "evolution_configs_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_recebidas" ADD CONSTRAINT "mensagens_recebidas_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_recebidas" ADD CONSTRAINT "mensagens_recebidas_evolutionId_fkey" FOREIGN KEY ("evolutionId") REFERENCES "evolution_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
