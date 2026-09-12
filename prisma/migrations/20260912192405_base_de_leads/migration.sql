-- CreateEnum
CREATE TYPE "OrigemLead" AS ENUM ('PEDIDO_PAGO', 'PEDIDO_PENDENTE', 'ENVIO', 'CONVERSA');

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "nome" TEXT,
    "email" TEXT,
    "emailNormalizado" TEXT,
    "telefone" TEXT,
    "telefoneNormalizado" TEXT,
    "cpfHash" TEXT,
    "cpfCifrado" TEXT,
    "primeiroContatoEm" TIMESTAMP(3) NOT NULL,
    "ultimoContatoEm" TIMESTAMP(3) NOT NULL,
    "totalPedidos" INTEGER NOT NULL DEFAULT 0,
    "totalEnvios" INTEGER NOT NULL DEFAULT 0,
    "valorTotalCentavos" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_origens" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "tipo" "OrigemLead" NOT NULL,
    "perfilId" TEXT,
    "pedidoId" TEXT,
    "shipmentId" TEXT,
    "conversaId" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_origens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leads_emailNormalizado_key" ON "leads"("emailNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "leads_telefoneNormalizado_key" ON "leads"("telefoneNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "leads_cpfHash_key" ON "leads"("cpfHash");

-- CreateIndex
CREATE INDEX "leads_ultimoContatoEm_idx" ON "leads"("ultimoContatoEm");

-- CreateIndex
CREATE INDEX "leads_nome_idx" ON "leads"("nome");

-- CreateIndex
CREATE INDEX "lead_origens_leadId_ocorridoEm_idx" ON "lead_origens"("leadId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "lead_origens_perfilId_idx" ON "lead_origens"("perfilId");

-- CreateIndex
--
-- O índice cobre colunas quase sempre nulas: uma origem preenche pedidoId
-- OU shipmentId OU conversaId, nunca os três. No Postgres, NULL é distinto
-- de NULL, então um índice único comum deixaria passar duas linhas iguais
-- sempre que a tripla nula coincidisse — que é o caso comum, não a exceção.
-- NULLS NOT DISTINCT (Postgres 15+) faz o índice comparar nulo com nulo, que
-- é o que a trava de idempotência sempre quis dizer. Mesmo cuidado tomado em
-- `20260903090000_trava_duplicata_com_nulos` para `mensagem_envios`; o Prisma
-- não sabe escrever essa cláusula, por isso esta linha é editada à mão e um
-- `migrate diff` futuro pode tentar recriar o índice sem ela.
CREATE UNIQUE INDEX "lead_origens_dedupe_key"
    ON "lead_origens" ("tipo", "pedidoId", "shipmentId", "conversaId")
 NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "lead_origens" ADD CONSTRAINT "lead_origens_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
