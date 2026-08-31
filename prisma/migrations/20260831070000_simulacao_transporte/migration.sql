-- Motor de simulação de transporte (spec 2026-08-31).
-- O roteiro inteiro é gravado na geração da etiqueta, com cada evento já
-- datado no futuro; a consulta só mostra os que já ocorreram.

CREATE TYPE "CenarioSimulacao" AS ENUM (
  'ENTREGA_NORMAL', 'ATRASO', 'TENTATIVA_FALHA', 'EXTRAVIO', 'DEVOLUCAO'
);

ALTER TABLE "shipments"
  ADD COLUMN "cenario" "CenarioSimulacao" NOT NULL DEFAULT 'ENTREGA_NORMAL',
  ADD COLUMN "simulacaoIniciadaEm" TIMESTAMP(3),
  ADD COLUMN "fatorSimulacao" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "devolvidoEm" TIMESTAMP(3);

-- Eventos pré-existentes não têm roteiro; recebem sequência por data e
-- código genérico para satisfazer o NOT NULL sem inventar histórico.
ALTER TABLE "tracking_events"
  ADD COLUMN "sequencia" INTEGER,
  ADD COLUMN "offsetMinutos" INTEGER,
  ADD COLUMN "codigo" TEXT,
  ADD COLUMN "unidadeOrigem" TEXT,
  ADD COLUMN "unidadeDestino" TEXT,
  ADD COLUMN "cidade" TEXT,
  ADD COLUMN "uf" TEXT,
  ADD COLUMN "forcado" BOOLEAN NOT NULL DEFAULT false;

UPDATE "tracking_events" AS te
SET "sequencia" = numerado.posicao,
    "offsetMinutos" = 0,
    "codigo" = te."status",
    "cidade" = COALESCE(te."local", ''),
    "uf" = ''
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "shipmentId" ORDER BY "ocorridoEm", "id") AS posicao
  FROM "tracking_events"
) AS numerado
WHERE te."id" = numerado."id";

ALTER TABLE "tracking_events"
  ALTER COLUMN "sequencia" SET NOT NULL,
  ALTER COLUMN "offsetMinutos" SET NOT NULL,
  ALTER COLUMN "codigo" SET NOT NULL,
  ALTER COLUMN "cidade" SET NOT NULL,
  ALTER COLUMN "uf" SET NOT NULL;

DROP INDEX "tracking_events_shipmentId_idx";
CREATE UNIQUE INDEX "tracking_events_shipmentId_sequencia_key"
  ON "tracking_events" ("shipmentId", "sequencia");
CREATE INDEX "tracking_events_shipmentId_ocorridoEm_idx"
  ON "tracking_events" ("shipmentId", "ocorridoEm");

CREATE TABLE "simulacao_config" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "fatorVelocidade" INTEGER NOT NULL DEFAULT 1,
  "operador" TEXT NOT NULL DEFAULT 'DE ENCOMENDAS',
  "atualizadoEm" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "simulacao_config_pkey" PRIMARY KEY ("id"),
  -- Registro único: a configuração é global, não pode haver uma segunda linha.
  CONSTRAINT "simulacao_config_singleton" CHECK ("id" = 'singleton')
);

INSERT INTO "simulacao_config" ("id", "atualizadoEm") VALUES ('singleton', NOW());
