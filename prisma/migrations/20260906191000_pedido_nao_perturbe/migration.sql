-- "Não persiga este comprador": a decisão passa a viver no PEDIDO.
--
-- `notificar_cliente: false` só valia para a requisição em que era mandado —
-- decidia se aquela chamada avisava, e morria ali. A régua de recuperação não
-- olha nada disso: ela varre pedido PENDENTE por idade e cria mensagem direto,
-- duzentos por regra por rodada.
--
-- Bastava uma regra ativa para milhares de "conclua sua compra" saírem para
-- gente que abandonou o carrinho semanas atrás — e a proteção que existia
-- (janela de sete dias) dependia de o importador lembrar de mandar `criado_em`.
-- Sem ele, `criadoEm` cai no `now()` e TODO pedido importado passa a parecer
-- nascido agora, atravessando por dentro da única trava que havia.
--
-- Uma trava que depende de quem chama lembrar de mandar um campo não é trava.
-- Esta vive no dado e vale para sempre.
ALTER TABLE "pedidos" ADD COLUMN "recuperavel" BOOLEAN NOT NULL DEFAULT true;

-- O que já foi importado não deve ser perseguido: entrou como histórico, não
-- como carrinho de agora.
UPDATE "pedidos" SET "recuperavel" = false
 WHERE "criadoEm" < now() - interval '7 days';

-- A régua procura por (perfil, recuperável, status, data). Sem o índice, ela
-- varre a tabela inteira a cada rodada, de cinco em cinco minutos.
CREATE INDEX "pedidos_perfilId_recuperavel_status_criadoEm_idx"
  ON "pedidos" ("perfilId", "recuperavel", status, "criadoEm");
