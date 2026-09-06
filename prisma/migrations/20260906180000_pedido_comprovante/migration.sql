-- O comprovante que o comprador mandou para a loja.
--
-- A plataforma não tinha onde recebê-lo, e o painel — que existe para
-- responder "o que aconteceu com este pedido" — não mostrava a única prova
-- que o comprador enviou.
--
-- TEXT, e não uma coluna de arquivo: o que a loja guarda hoje é uma URI de
-- dados (`data:image/jpeg;base64,...`), cerca de 95 KB por comprovante, e são
-- dezenas, não milhares. Aceitar também um endereço http é de propósito — é
-- para onde isto deve caminhar, e o dia em que a loja passar a guardar o
-- arquivo fora do banco nada aqui precisa mudar.
ALTER TABLE "pedidos" ADD COLUMN "comprovante" TEXT;
ALTER TABLE "pedidos" ADD COLUMN "comprovanteEm" TIMESTAMP(3);

-- Quem mandou comprovante é um recorte que se procura, e são poucos entre
-- muitos: o índice parcial não carrega os milhares que não têm.
CREATE INDEX "pedidos_perfilId_comprovanteEm_idx"
  ON "pedidos" ("perfilId", "comprovanteEm")
  WHERE "comprovanteEm" IS NOT NULL;
