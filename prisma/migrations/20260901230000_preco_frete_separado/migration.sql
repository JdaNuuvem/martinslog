-- Separa o frete calculado do que a plataforma cobra pela etiqueta.
--
-- Até aqui `precoCobradoCentavos` era o frete da tabela, e era ele que saía
-- da carteira. O modelo do produto é outro: o frete é calculado e exibido —
-- é o número que a etiqueta e o rastreio mostram — mas o cliente paga um
-- valor fixo por etiqueta gerada.
--
-- Os dois números passam a existir lado a lado, porque são coisas
-- diferentes: `precoFreteCentavos` é o que o frete custaria, e
-- `precoCobradoCentavos` é o que foi debitado. Guardar só um deles obrigaria
-- a inventar o outro depois.
--
-- Envios que já existem recebem no campo novo o valor que estava em
-- `precoCobradoCentavos`, que era justamente o frete no modelo antigo. O que
-- eles cobraram de fato continua onde está: o histórico financeiro não é
-- reescrito por mudança de política de preço.
ALTER TABLE "shipments" ADD COLUMN "precoFreteCentavos" INTEGER NOT NULL DEFAULT 0;

UPDATE "shipments" SET "precoFreteCentavos" = "precoCobradoCentavos";
