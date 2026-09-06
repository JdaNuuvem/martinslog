-- A identidade do provedor entra na trava contra repetição.
--
-- A trava foi desenhada para o que a PLATAFORMA envia:
-- `(perfil, evento, canal, pedido, envio, regra)` com `NULLS NOT DISTINCT`.
-- Numa mensagem REPORTADA pela loja, `envio` e `regra` são sempre nulos e
-- `pedido` fica nulo sempre que o código do pedido não é encontrado — e a
-- chave desaba para `(perfil, evento, canal)`.
--
-- O efeito seria brutal e silencioso: três mil e-mails "pagamento confirmado"
-- da mesma loja virariam UM, e os outros voltariam contados como REPETIDOS —
-- o número que a rota devolve justamente como prova de que a importação é
-- segura de repetir. O operador leria "500 repetidas", concluiria que já tinha
-- importado, e teria perdido o lote inteiro.
--
-- Na importação de hoje isso não aconteceu, mas por ACIDENTE: o assunto
-- carregava o código do pedido e o evento saiu único por tabela. Identidade
-- que depende de o texto do assunto ser diferente não é identidade. Um teste
-- que manda dois e-mails com o mesmo evento e assunto vazio pega o defeito.
--
-- Um índice separado não resolveria: ele acrescentaria uma trava sem soltar a
-- que colapsa. A coluna tem que entrar NA chave.
--
-- Acrescentar coluna a uma chave só a torna MAIS permissiva, então nada que
-- hoje é distinto passa a colidir. E o que a plataforma enfileira continua
-- deduplicando igual: ali `idExterno` é nulo até o envio, e `NULLS NOT
-- DISTINCT` mantém dois nulos como o mesmo valor.
DROP INDEX IF EXISTS "mensagem_envios_dedupe_key";

CREATE UNIQUE INDEX "mensagem_envios_dedupe_key"
  ON "mensagem_envios" ("perfilId", evento, canal, "pedidoId", "shipmentId", "regraId", "idExterno")
  NULLS NOT DISTINCT;
