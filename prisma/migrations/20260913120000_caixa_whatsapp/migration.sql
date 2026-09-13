-- Caixa de entrada de WhatsApp: conversa por jid, mídia, status e respostas prontas.
--
-- A conversa deixa de ser chaveada pelo telefone. O WhatsApp novo entrega a
-- maioria dos contatos como `NNN@lid`, que nao e telefone; a chave passa a ser
-- o jid completo. `contato` e RENOMEADA para `telefone` (e vira opcional) em
-- vez de apagada: toda linha existente tinha um telefone de verdade, e o jid
-- dela e reconstruido a partir dele.
--
-- NAO mexe nos indices de `pedidos` nem de `mensagem_envios`: o Prisma pede
-- isso toda vez porque nao sabe escrever indice PARCIAL nem NULLS NOT
-- DISTINCT. Ver a migration 20260911062749.

-- CreateEnum
CREATE TYPE "TipoMensagemWhatsapp" AS ENUM ('TEXTO', 'AUDIO', 'IMAGEM', 'VIDEO', 'DOCUMENTO', 'FIGURINHA', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusMensagemWhatsapp" AS ENUM ('ENVIANDO', 'ENVIADA', 'ENTREGUE', 'LIDA', 'ERRO');

-- conversas: contato -> telefone + jid
DROP INDEX "conversas_perfilId_contato_key";
ALTER TABLE "conversas" RENAME COLUMN "contato" TO "telefone";
ALTER TABLE "conversas" ALTER COLUMN "telefone" DROP NOT NULL;
ALTER TABLE "conversas" ADD COLUMN "jid" TEXT;
UPDATE "conversas" SET "jid" = "telefone" || '@s.whatsapp.net' WHERE "jid" IS NULL;
ALTER TABLE "conversas" ALTER COLUMN "jid" SET NOT NULL;
ALTER TABLE "conversas" ADD COLUMN "fotoUrl" TEXT;
ALTER TABLE "conversas" ADD COLUMN "previa" TEXT;
ALTER TABLE "conversas" ADD COLUMN "previaTipo" "TipoMensagemWhatsapp" NOT NULL DEFAULT 'TEXTO';

CREATE UNIQUE INDEX "conversas_perfilId_jid_key" ON "conversas"("perfilId", "jid");
CREATE INDEX "conversas_perfilId_telefone_idx" ON "conversas"("perfilId", "telefone");

-- conversa_mensagens: texto opcional, tipo, status, metadados de midia
ALTER TABLE "conversa_mensagens" ALTER COLUMN "texto" DROP NOT NULL;
ALTER TABLE "conversa_mensagens" ADD COLUMN "tipo" "TipoMensagemWhatsapp" NOT NULL DEFAULT 'TEXTO';
ALTER TABLE "conversa_mensagens" ADD COLUMN "status" "StatusMensagemWhatsapp" NOT NULL DEFAULT 'ENVIADA';
ALTER TABLE "conversa_mensagens" ADD COLUMN "midiaMimetype" TEXT;
ALTER TABLE "conversa_mensagens" ADD COLUMN "midiaNome" TEXT;
ALTER TABLE "conversa_mensagens" ADD COLUMN "midiaTamanho" INTEGER;
ALTER TABLE "conversa_mensagens" ADD COLUMN "midiaDuracao" INTEGER;

-- Mensagem que ja estava gravada com erro nao saiu: o status tem que dizer isso.
UPDATE "conversa_mensagens" SET "status" = 'ERRO' WHERE "erro" IS NOT NULL;

-- Previa das conversas que ja existiam, pela ultima mensagem de cada uma.
UPDATE "conversas" c
SET "previa" = ultima."texto"
FROM (
  SELECT DISTINCT ON ("conversaId") "conversaId", "texto"
  FROM "conversa_mensagens"
  ORDER BY "conversaId", "ocorridoEm" DESC
) ultima
WHERE ultima."conversaId" = c."id";

-- evolution_configs: importacao do historico
ALTER TABLE "evolution_configs" ADD COLUMN "sincronizadoEm" TIMESTAMP(3);
ALTER TABLE "evolution_configs" ADD COLUMN "sincronizandoDesde" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "templates_whatsapp" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "atalho" TEXT,
    "texto" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "templates_whatsapp_perfilId_atalho_key" ON "templates_whatsapp"("perfilId", "atalho");

-- CreateIndex
CREATE INDEX "templates_whatsapp_perfilId_ordem_idx" ON "templates_whatsapp"("perfilId", "ordem");

-- AddForeignKey
ALTER TABLE "templates_whatsapp" ADD CONSTRAINT "templates_whatsapp_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
