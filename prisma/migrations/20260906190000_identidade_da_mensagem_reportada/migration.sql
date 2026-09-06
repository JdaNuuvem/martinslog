-- Índice de apoio para consultar mensagem pelo id do provedor.
--
-- A UNICIDADE dessa identidade não mora aqui: ela entra na chave de
-- deduplicação, na migration `20260906192000`. Ver o comentário de lá para o
-- motivo — em resumo, uma trava separada não impediria a chave principal de
-- colapsar mensagens distintas.
CREATE INDEX IF NOT EXISTS "mensagem_envios_perfilId_canal_idExterno_idx"
  ON "mensagem_envios" ("perfilId", canal, "idExterno");
