-- O QUE a mensagem dizia, e não só que ela saiu.
--
-- O texto do SMS era composto no instante do envio, a partir do template e dos
-- valores daquele momento, e descartado em seguida. A tela mostrava
-- "PEDIDO_PAGO · enviada" — e quando o comprador ligava dizendo que a mensagem
-- veio errada, ou não veio, não havia como saber o que ele recebeu.
--
-- Recompor depois não serve: o template pode ter sido editado, e o código de
-- rastreio pode ter mudado. O texto tem que ser congelado no envio, que é o
-- único instante em que ele é verdade.
--
-- `assunto` sai de dentro do `evento`. Ele estava concatenado ali
-- ("PAGO — Pagamento confirmado — pedido PED-X") porque não havia coluna, e
-- isso quebrava o filtro por evento: cada e-mail virava um evento diferente.
ALTER TABLE "mensagem_envios" ADD COLUMN "texto" TEXT;
ALTER TABLE "mensagem_envios" ADD COLUMN "assunto" TEXT;
