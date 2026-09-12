-- O código do pedido na loja, guardado junto do envio.
--
-- Existe para o comprador ver UM código só. Hoje ele recebe o código da loja
-- no e-mail e o nosso no rastreio, sem nada que ligue os dois — e a dúvida
-- vira contato no suporte de quem vendeu.
--
-- Deliberadamente NÃO é único. A loja é dona do próprio espaço de códigos, e
-- uma trava de unicidade aqui faria a nossa regra recusar um envio legítimo
-- dela (um pedido dividido em duas caixas, por exemplo). A idempotência de
-- pedido mora em `pedidos.externalId`, onde a decisão é nossa.
--
-- Também é opcional: quem já integrou continua funcionando sem mandar nada.
ALTER TABLE "shipments" ADD COLUMN     "referenciaExterna" TEXT;

-- Índice para achar o envio pelo código da loja, que é como o suporte procura
-- quando o comprador liga com o número do pedido na mão.
CREATE INDEX "shipments_referenciaExterna_idx" ON "shipments" ("referenciaExterna");
