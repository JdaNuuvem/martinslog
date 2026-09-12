-- A trava anti-duplicata não travava nada nas mensagens que realmente saem.
--
-- O índice era `UNIQUE (perfilId, evento, canal, pedidoId, shipmentId)`, e no
-- Postgres um índice único comum trata NULL como valor sempre diferente de si
-- mesmo: basta UMA coluna nula na tupla para que duas linhas idênticas sejam
-- aceitas as duas.
--
-- Toda mensagem que já mandamos tem `pedidoId` nulo — o aviso de pagamento
-- nasce de um envio, não de um pedido. Ou seja: a garantia valia para o caso
-- que não acontece e não valia para o que acontece sempre.
--
-- Provado nesta base, Postgres 16.15: duas linhas iguais com colunas nulas,
-- duas aceitas. E o teste que existia não pegava, porque o disparo também
-- descarta repetição pelo status — a corrida que a trava existe para cobrir é
-- justamente a que o status não cobre: dois disparos simultâneos lendo a fila
-- antes de qualquer um dos dois gravar.
--
-- `NULLS NOT DISTINCT` (Postgres 15+) faz o índice comparar nulo com nulo, que
-- é o que a regra sempre quis dizer.
--
-- `regraId` entra na chave por causa da régua de recuperação: várias regras
-- para o mesmo pedido são o desenho — 15 minutos, 2 horas, 24 horas — e sem
-- ela a segunda cobrança seria barrada como se fosse repetição da primeira.
--
-- ATENÇÃO A QUEM MEXER NO SCHEMA: o Prisma não sabe escrever
-- `NULLS NOT DISTINCT`. O `@@unique` continua declarado lá, e um
-- `migrate diff` pode gerar SQL que recria este índice SEM a cláusula,
-- desfazendo a correção em silêncio. Se isso acontecer, é este arquivo que
-- vale.

ALTER TABLE "mensagem_envios" ADD COLUMN     "regraId" TEXT;

-- Duplicatas que já tenham entrado impediriam a criação do índice. Não há
-- critério de negócio para escolher qual fica, então fica a mais antiga: é a
-- que corresponde à mensagem que o comprador de fato recebeu primeiro.
DELETE FROM "mensagem_envios" a
 USING "mensagem_envios" b
 WHERE a."criadoEm" > b."criadoEm"
   AND a."perfilId" = b."perfilId"
   AND a."evento" = b."evento"
   AND a."canal" = b."canal"
   AND a."pedidoId" IS NOT DISTINCT FROM b."pedidoId"
   AND a."shipmentId" IS NOT DISTINCT FROM b."shipmentId";

DROP INDEX IF EXISTS "mensagem_envios_perfilId_evento_canal_pedidoId_shipmentId_key";

CREATE UNIQUE INDEX "mensagem_envios_dedupe_key"
    ON "mensagem_envios" ("perfilId", "evento", "canal", "pedidoId", "shipmentId", "regraId")
 NULLS NOT DISTINCT;

CREATE INDEX "mensagem_envios_regraId_idx" ON "mensagem_envios" ("regraId");
