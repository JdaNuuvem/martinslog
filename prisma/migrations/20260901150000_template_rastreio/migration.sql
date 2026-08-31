-- Template de percurso montado pela conta.
--
-- Alternativa ao roteiro automático por cenário: a conta declara a sequência
-- exata de etapas que os envios dela percorrem. Quem não tiver template ativo
-- continua no caminho padrão da simulação — a ausência de linha é o padrão,
-- não uma linha com "usar padrão".
--
-- Os passos ficam em JSON, e não em tabela filha, porque são lidos e
-- gravados sempre juntos, na ordem: a ordem é o dado. Uma tabela filha
-- exigiria coluna de posição e uma junção em toda leitura para reconstruir
-- algo que nunca é consultado passo a passo.
CREATE TABLE "rastreio_templates" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "ativo"        BOOLEAN NOT NULL DEFAULT true,
  "passos"       JSONB NOT NULL,
  "criadoEm"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizadoEm" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rastreio_templates_pkey" PRIMARY KEY ("id")
);

-- Um template por conta: o percurso é único por definição, e permitir vários
-- abriria a pergunta de qual vale na emissão.
CREATE UNIQUE INDEX "rastreio_templates_userId_key" ON "rastreio_templates" ("userId");

ALTER TABLE "rastreio_templates"
  ADD CONSTRAINT "rastreio_templates_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
