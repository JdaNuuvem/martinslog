-- Perfis de envio, WhatsApp oficial, templates, pedidos e recuperação.
--
-- Até aqui tudo era por conta: um webhook, um template de rastreio, uma
-- configuração de e-mail. Quem opera três marcas era obrigado a criar três
-- contas e perder a visão do conjunto. `perfis` é a camada que faltava entre
-- a conta e o que fala com o comprador.
--
-- A divisão é deliberada: o que é do perfil é o que o comprador vê (número de
-- WhatsApp, texto da mensagem, destino de webhook); o que é da conta continua
-- na conta (carteira, tokens de API, endereços). Dinheiro e credencial de
-- integração não se multiplicam por marca.
--
-- `shipments.perfilId` e `webhook_apps.perfilId` entram anuláveis de
-- propósito: as linhas que já existem nasceram antes dos perfis e continuam
-- válidas. Torná-las obrigatórias exigiria inventar um perfil para dados
-- históricos, e um perfil inventado apareceria no seletor do cliente.
--
-- `pedidos` é a novidade de conceito. A plataforma só conhecia envios, e envio
-- só nasce depois do pagamento — o que torna impossível recuperar a venda que
-- NÃO foi paga, justamente a que vale dinheiro. O par
-- (`perfilId`, `externalId`) é único: é ele que impede o mesmo pedido de virar
-- dois quando a loja repete a chamada. A API pública de envios não tem essa
-- trava e a deduplicação fica com o integrador; aqui o erro não se repete.
--
-- Nenhuma operação é destrutiva: só tabelas novas, dois tipos novos e duas
-- colunas anuláveis.

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusMensagem" AS ENUM ('PENDENTE', 'ENVIADA', 'FALHA', 'DESISTIU');

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "perfilId" TEXT;

-- AlterTable
ALTER TABLE "webhook_apps" ADD COLUMN     "perfilId" TEXT;

-- AlterTable
ALTER TABLE "api_tokens" ADD COLUMN     "perfilId" TEXT;

-- CreateTable
CREATE TABLE "perfis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_configs" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "tokenCifrado" TEXT NOT NULL,
    "dicaToken" TEXT NOT NULL,
    "numeroExibicao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "verificadaEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem_templates" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'pt_BR',
    "previa" TEXT NOT NULL,
    "variaveis" JSONB NOT NULL DEFAULT '[]',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mensagem_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'PENDENTE',
    "clienteNome" TEXT NOT NULL,
    "clienteFone" TEXT NOT NULL,
    "clienteEmail" TEXT,
    "valorCentavos" INTEGER NOT NULL DEFAULT 0,
    "produtos" JSONB NOT NULL DEFAULT '[]',
    "checkoutUrl" TEXT,
    "shipmentId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras_recuperacao" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "atrasoMinutos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_recuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem_envios" (
    "id" TEXT NOT NULL,
    "perfilId" TEXT NOT NULL,
    "templateId" TEXT,
    "pedidoId" TEXT,
    "shipmentId" TEXT,
    "evento" TEXT NOT NULL,
    "para" TEXT NOT NULL,
    "status" "StatusMensagem" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "idExterno" TEXT,
    "erro" TEXT,
    "proximaTentativaEm" TIMESTAMP(3),
    "enviadaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagem_envios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perfis_userId_ativo_idx" ON "perfis"("userId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "perfis_userId_nome_key" ON "perfis"("userId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_configs_perfilId_key" ON "whatsapp_configs"("perfilId");

-- CreateIndex
CREATE INDEX "mensagem_templates_perfilId_ativo_idx" ON "mensagem_templates"("perfilId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_templates_perfilId_evento_key" ON "mensagem_templates"("perfilId", "evento");

-- CreateIndex
CREATE INDEX "pedidos_perfilId_status_criadoEm_idx" ON "pedidos"("perfilId", "status", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_perfilId_externalId_key" ON "pedidos"("perfilId", "externalId");

-- CreateIndex
CREATE INDEX "regras_recuperacao_perfilId_ativo_idx" ON "regras_recuperacao"("perfilId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "regras_recuperacao_perfilId_atrasoMinutos_key" ON "regras_recuperacao"("perfilId", "atrasoMinutos");

-- CreateIndex
CREATE INDEX "mensagem_envios_proximaTentativaEm_status_idx" ON "mensagem_envios"("proximaTentativaEm", "status");

-- CreateIndex
CREATE INDEX "mensagem_envios_perfilId_criadoEm_idx" ON "mensagem_envios"("perfilId", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_envios_perfilId_evento_pedidoId_shipmentId_key" ON "mensagem_envios"("perfilId", "evento", "pedidoId", "shipmentId");

-- CreateIndex
CREATE INDEX "shipments_perfilId_status_idx" ON "shipments"("perfilId", "status");

-- CreateIndex
CREATE INDEX "webhook_apps_perfilId_ativo_idx" ON "webhook_apps"("perfilId", "ativo");

-- CreateIndex
CREATE INDEX "api_tokens_perfilId_idx" ON "api_tokens"("perfilId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_apps" ADD CONSTRAINT "webhook_apps_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfis" ADD CONSTRAINT "perfis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_configs" ADD CONSTRAINT "whatsapp_configs_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_templates" ADD CONSTRAINT "mensagem_templates_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_recuperacao" ADD CONSTRAINT "regras_recuperacao_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras_recuperacao" ADD CONSTRAINT "regras_recuperacao_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "mensagem_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_envios" ADD CONSTRAINT "mensagem_envios_perfilId_fkey" FOREIGN KEY ("perfilId") REFERENCES "perfis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_envios" ADD CONSTRAINT "mensagem_envios_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "mensagem_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_envios" ADD CONSTRAINT "mensagem_envios_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

