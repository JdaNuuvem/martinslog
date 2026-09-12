-- Cria um perfil para cada conta que ainda não tem, e liga o que já existe.
--
-- Os perfis nasceram na migration anterior e ninguém foi criado: as contas
-- seguem sem nenhum, e os tokens de produção emitidos até aqui apontam para
-- perfil nulo. Como toda configuração de mensagem (WhatsApp, SMS, textos)
-- pende do perfil, hoje ela não teria onde se apoiar — o envio nasceria sem
-- dono e o comprador não seria avisado, sem nada acusar.
--
-- A migration é o lugar certo, e não um comando digitado no banco: isto muda
-- dado de produção e precisa ficar onde alguém possa revisar o que foi feito e
-- por quê.
--
-- O perfil recebe o nome da conta. É provisório e mexível na tela — serve para
-- a loja se reconhecer no seletor enquanto ninguém renomeou nada.

INSERT INTO "perfis" ("id", "userId", "nome", "ativo", "criadoEm")
SELECT
  -- `gen_random_uuid()` está disponível no Postgres 13+ sem extensão. O id não
  -- precisa ser cuid como os criados pela aplicação: nada o interpreta, só o
  -- compara.
  gen_random_uuid()::text,
  u."id",
  u."nome",
  true,
  now()
FROM "users" u
WHERE u."papel" = 'CLIENTE'
  AND NOT EXISTS (SELECT 1 FROM "perfis" p WHERE p."userId" = u."id");

-- Liga os tokens já emitidos ao perfil da conta.
--
-- Sem isto, o envio criado por um token antigo continuaria nascendo sem perfil
-- e sem mensagem. Só toca os que estão nulos: um token que já aponta para um
-- perfil foi criado assim de propósito.
UPDATE "api_tokens" t
   SET "perfilId" = p."id"
  FROM "perfis" p
 WHERE p."userId" = t."userId"
   AND t."perfilId" IS NULL;

-- Idem para os envios que já existem, para que o histórico e o rastreio deles
-- fiquem sob a mesma loja.
UPDATE "shipments" s
   SET "perfilId" = p."id"
  FROM "perfis" p
 WHERE p."userId" = s."userId"
   AND s."perfilId" IS NULL;
