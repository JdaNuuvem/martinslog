-- Catálogo de status de rastreio personalizável por conta.
--
-- Até aqui, título e descrição de cada evento eram constantes no código
-- (`TEXTOS` em src/domain/simulacao/roteiro.ts) e o conjunto de códigos era
-- uma união fechada em TypeScript. Isso vira dado para que cada cliente
-- ajuste a linguagem que o destinatário dele lê, e crie etapas próprias.
--
-- `userId` nulo marca a linha do catálogo padrão da plataforma: é o texto
-- usado por quem nunca personalizou nada. A resolução por envio sobrepõe o
-- padrão com as linhas do dono do envio, então uma conta que muda uma copy
-- não perde as outras dez.
CREATE TABLE "status_rastreio" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT,
  "codigo"           TEXT NOT NULL,
  "titulo"           TEXT NOT NULL,
  "descricao"        TEXT NOT NULL,
  -- Preenchidos apenas em status criados pelo cliente. Um status que só
  -- reescreve a copy de um código existente deixa os três nulos e não
  -- altera a forma do roteiro.
  "cenario"          "CenarioSimulacao",
  "fracaoPrazo"      DOUBLE PRECISION,
  "statusResultante" "StatusShipment",
  "ativo"            BOOLEAN NOT NULL DEFAULT true,
  "criadoEm"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "status_rastreio_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "status_rastreio"
  ADD CONSTRAINT "status_rastreio_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Um código por conta. O índice único comum não serve para o catálogo
-- padrão, porque no Postgres NULL nunca é igual a NULL e nada impediria
-- duas linhas padrão com o mesmo código — daí o índice parcial separado.
CREATE UNIQUE INDEX "status_rastreio_userId_codigo_key"
  ON "status_rastreio" ("userId", "codigo")
  WHERE "userId" IS NOT NULL;

CREATE UNIQUE INDEX "status_rastreio_padrao_codigo_key"
  ON "status_rastreio" ("codigo")
  WHERE "userId" IS NULL;

CREATE INDEX "status_rastreio_userId_idx" ON "status_rastreio" ("userId");
