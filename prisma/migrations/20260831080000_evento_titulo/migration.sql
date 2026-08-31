-- A timeline da seção 7 da spec mostra título e descrição como elementos
-- visuais distintos (título colorido, descrição em texto corrido). O
-- gerador de roteiro já produz os dois; a tabela passa a guardar ambos, em
-- vez de a interface reconstruir o título a partir do código do evento.
ALTER TABLE "tracking_events" ADD COLUMN "titulo" TEXT;

-- Eventos anteriores não têm título próprio: repetem a descrição, que é o
-- texto que o cliente já viu. Não se inventa histórico.
UPDATE "tracking_events" SET "titulo" = "descricao" WHERE "titulo" IS NULL;

ALTER TABLE "tracking_events" ALTER COLUMN "titulo" SET NOT NULL;
