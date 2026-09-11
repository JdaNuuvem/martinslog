-- Mensagens personalizadas por loja: textos de evento, respostas do robo
-- por palavra-chave, e campanhas.
--
-- NAO mexe nos indices de `pedidos` nem de `mensagem_envios`. Ver a
-- migration 20260911062749.

-- CreateEnum
CREATE TYPE "StatusCampanha" AS ENUM ('RASCUNHO', 'AGENDADA', 'ENVIANDO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusDestinatario" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHA');

-- CreateTable
CREATE TABLE "respostas_automaticas" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "gatilhos" TEXT[],
    "resposta" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respostas_automaticas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanhas" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "status" "StatusCampanha" NOT NULL DEFAULT 'RASCUNHO',
    "agendadaPara" TIMESTAMP(3),
    "iniciadaEm" TIMESTAMP(3),
    "concluidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campanhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanha_destinatarios" (
    "id" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,
    "contato" TEXT NOT NULL,
    "nome" TEXT,
    "status" "StatusDestinatario" NOT NULL DEFAULT 'PENDENTE',
    "erro" TEXT,
    "idExterno" TEXT,
    "enviadaEm" TIMESTAMP(3),

    CONSTRAINT "campanha_destinatarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "respostas_automaticas_perfilId_ativo_ordem_idx" ON "respostas_automaticas"("perfilId", "ativo", "ordem");

-- CreateIndex
CREATE INDEX "campanhas_status_agendadaPara_idx" ON "campanhas"("status", "agendadaPara");

-- CreateIndex
CREATE INDEX "campanhas_perfilId_criadoEm_idx" ON "campanhas"("perfilId", "criadoEm");

-- CreateIndex
CREATE INDEX "campanha_destinatarios_campanhaId_status_idx" ON "campanha_destinatarios"("campanhaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campanha_destinatarios_campanhaId_contato_key" ON "campanha_destinatarios"("campanhaId", "contato");

-- AddForeignKey
ALTER TABLE "respostas_automaticas" ADD CONSTRAINT "respostas_automaticas_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_destinatarios" ADD CONSTRAINT "campanha_destinatarios_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "campanhas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
