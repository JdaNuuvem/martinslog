-- Fonte do sequencial dos códigos de rastreio.
--
-- Uma SEQUENCE do Postgres, e não uma coluna contadora, porque `nextval` é
-- atômico e não transacional: duas emissões simultâneas recebem números
-- diferentes sem disputar lock, e um rollback não devolve o número ao poço
-- (o que reemitiria um código já impresso em etiqueta).
--
-- MAXVALUE 99999999 acompanha os oito dígitos do formato do código; NO CYCLE
-- faz a sequência estourar com erro em vez de voltar ao 1 e reemitir códigos
-- já usados. Ao chegar perto do limite, o caminho é ampliar o formato, não
-- reciclar números.
--
-- Não é representável no schema Prisma (não existe modelo para sequências
-- avulsas), então vive apenas aqui. `IF NOT EXISTS` mantém a migration
-- idempotente para bancos onde ela já foi aplicada à mão.
CREATE SEQUENCE IF NOT EXISTS tracking_code_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 99999999
  NO CYCLE;
