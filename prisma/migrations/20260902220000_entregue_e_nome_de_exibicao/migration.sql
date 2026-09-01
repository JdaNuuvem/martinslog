-- Duas coisas que os testes reais expuseram.
--
-- 1. `entregueEm`: separar "o provedor aceitou" de "chegou no aparelho".
--
-- Os dois estados se separam na prática. Em seis envios reais, duas mensagens
-- quase idênticas saíram com minutos de diferença: uma foi confirmada no
-- aparelho, a outra ficou sete minutos em "aceita" e nunca chegou. Sem este
-- campo, as duas ficavam gravadas exatamente igual.
--
-- Pior: o aviso de situação do provedor não tinha onde escrever e gravava o
-- mesmo estado que a mensagem já tinha. O recurso existia e não produzia
-- informação nenhuma — para saber se chegou era preciso consultar o provedor à
-- mão, uma mensagem por vez, que foi como os seis testes foram conferidos.
--
-- Nulo não significa "não chegou": significa "ninguém confirmou". Nem toda
-- operadora devolve confirmação.
ALTER TABLE "mensagem_envios" ADD COLUMN     "entregueEm" TIMESTAMP(3);

-- 2. O nome que o comprador vê.
--
-- As lojas operam dentro do TikTok Shop, e é de lá que o comprador se lembra —
-- ele nunca ouviu falar de "Best Buy Tech" nem de "Loja PG". Sem isto, o SMS
-- chegava assinado com o nome interno do painel, que para quem recebe é um
-- remetente desconhecido: o caminho mais curto para ser denunciado como spam.
--
-- Vai como UPDATE nominal, e não como padrão da coluna, porque isto é uma
-- decisão comercial destas contas e não uma regra do produto. Perfil novo
-- continua nascendo sem nome de exibição e caindo no nome interno.
UPDATE "perfis"
   SET "nomeExibicao" = 'Tiktok shop'
 WHERE "userId" IN (
   SELECT "id" FROM "users"
    WHERE "email" IN (
      'bruteforce@gmail.com',
      'pg@gmail.com',
      'bestbuytech@gmail.com',
      'cliente@frete.teste'
    )
 );
