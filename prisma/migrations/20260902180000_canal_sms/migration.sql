-- Canal da mensagem: WhatsApp ou SMS.
--
-- A ordem escolhida foi SMS primeiro. O WhatsApp oficial não sobe rápido: exige
-- conta comercial na Meta, verificação da empresa e cada texto aprovado como
-- template antes do primeiro envio. SMS não tem nenhuma dessas etapas — o
-- comprador passa a ser avisado enquanto a aprovação corre.
--
-- O canal entra nas DUAS chaves únicas, e isso não é detalhe:
--
--   * em `mensagem_templates`, sem o canal a loja teria de escolher entre ter
--     texto de SMS OU de WhatsApp para o mesmo evento;
--   * em `mensagem_envios`, sem o canal o SMS já enviado bloquearia o WhatsApp
--     do mesmo evento — em silêncio, tratado como repetição.
--
-- Os dois DROP INDEX são seguros: as duas tabelas nasceram na migration
-- anterior e estão vazias (conferido em produção antes de gerar este arquivo).
--
-- `sms_configs` espelha `whatsapp_configs` pelo mesmo motivo: cada loja paga o
-- próprio envio e aparece como o próprio remetente. `provedor` é texto e não
-- enum porque o fornecedor ainda não foi escolhido — um enum obrigaria a uma
-- migration a cada troca, que é justamente o que a interface `SmsProvider`
-- existe para evitar.
--
-- `mensagem_envios.provedor` grava por onde a mensagem saiu de fato. Sem ele,
-- "o cliente não recebeu" não distingue falha do fornecedor de canal que nunca
-- chegou a ser contratado.

-- CreateEnum
CREATE TYPE "CanalMensagem" AS ENUM ('WHATSAPP', 'SMS');

-- DropIndex
DROP INDEX "mensagem_templates_perfilId_evento_key";

-- DropIndex
DROP INDEX "mensagem_envios_perfilId_evento_pedidoId_shipmentId_key";

-- AlterTable
ALTER TABLE "mensagem_templates" ADD COLUMN     "canal" "CanalMensagem" NOT NULL DEFAULT 'WHATSAPP';

-- AlterTable
ALTER TABLE "mensagem_envios" ADD COLUMN     "canal" "CanalMensagem" NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN     "provedor" TEXT;

-- CreateTable
CREATE TABLE "sms_configs" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL,
    "identificador" TEXT,
    "chaveCifrada" TEXT NOT NULL,
    "dicaChave" TEXT NOT NULL,
    "remetente" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "verificadaEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sms_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_configs_perfilId_key" ON "sms_configs"("perfilId");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_templates_perfilId_evento_canal_key" ON "mensagem_templates"("perfilId", "evento", "canal");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_envios_perfilId_evento_canal_pedidoId_shipmentId_key" ON "mensagem_envios"("perfilId", "evento", "canal", "pedidoId", "shipmentId");

-- AddForeignKey
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nome que o COMPRADOR vê nas mensagens, separado do nome interno.
--
-- Os dois raramente coincidem. O operador precisa distinguir "Best Buy Tech"
-- de "Loja PG" no painel; o comprador nunca ouviu falar de nenhum dos dois —
-- ele lembra do lugar onde comprou. Sem a separação, ou o painel fica com
-- vários perfis de nome igual, ou o comprador recebe mensagem de um remetente
-- que não reconhece e denuncia como spam.
--
-- Nulo usa o nome interno, que é o comportamento de quem não configurou nada.
ALTER TABLE "perfis" ADD COLUMN     "nomeExibicao" TEXT;
