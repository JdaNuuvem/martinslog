-- Conversa com o comprador: entrada, saida e controle do robo.
--
-- `mensagens_recebidas` nasceu hoje, nunca recebeu uma linha, e cobria so a
-- entrada. A tela precisa das duas direcoes na mesma ordem, entao ela vira
-- `conversas` + `conversa_mensagens` em vez de virar a segunda metade de um
-- par que teria de ser unido e reordenado a cada abertura.
--
-- NAO mexe nos indices de `pedidos` nem de `mensagem_envios`: o Prisma pede
-- isso toda vez porque nao sabe escrever indice PARCIAL nem NULLS NOT
-- DISTINCT. Ver a migration 20260911062749.

-- CreateEnum
CREATE TYPE "AutorMensagem" AS ENUM ('CLIENTE', 'ROBO', 'ATENDENTE');

-- DropForeignKey
ALTER TABLE "mensagens_recebidas" DROP CONSTRAINT "mensagens_recebidas_evolutionId_fkey";

-- DropForeignKey
ALTER TABLE "mensagens_recebidas" DROP CONSTRAINT "mensagens_recebidas_perfilId_fkey";

-- DropTable
DROP TABLE "mensagens_recebidas";

-- CreateTable
CREATE TABLE "conversas" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "contato" TEXT NOT NULL,
    "nomeContato" TEXT,
    "ultimaMensagemEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "roboPausadoAte" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversa_mensagens" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "autor" "AutorMensagem" NOT NULL,
    "texto" TEXT NOT NULL,
    "idExterno" TEXT,
    "erro" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "conversa_mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversas_perfilId_ultimaMensagemEm_idx" ON "conversas"("perfilId", "ultimaMensagemEm");

-- CreateIndex
CREATE UNIQUE INDEX "conversas_perfilId_contato_key" ON "conversas"("perfilId", "contato");

-- CreateIndex
CREATE UNIQUE INDEX "conversa_mensagens_idExterno_key" ON "conversa_mensagens"("idExterno");

-- CreateIndex
CREATE INDEX "conversa_mensagens_conversaId_ocorridoEm_idx" ON "conversa_mensagens"("conversaId", "ocorridoEm");

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa_mensagens" ADD CONSTRAINT "conversa_mensagens_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
