-- Contas isentas da taxa por etiqueta.
--
-- Isenção, e não saldo infinito. A alternativa seria creditar as carteiras com
-- um valor alto, e ela é pior do que parece: o crédito entraria no livro-caixa
-- como receita que ninguém pagou, e todo relatório financeiro passaria a somar
-- dinheiro inventado. Aqui a conta isenta simplesmente não gera lançamento —
-- `charged` responde falso na API pública, que é a verdade.
--
-- A isenção não afrouxa nenhuma outra regra: posse do envio, recusa de envio
-- sandbox pelo caminho real, cotação vencida e transição de estado continuam
-- valendo. Ela tira o dinheiro do caminho, não as regras.
--
-- O padrão é `false` e nada na interface concede isenção: é exceção nominal,
-- ligada uma conta por vez.
ALTER TABLE "users" ADD COLUMN     "isentoCobranca" BOOLEAN NOT NULL DEFAULT false;

-- As contas isentas de hoje: as três lojas parceiras e a conta de teste da
-- própria plataforma.
--
-- Vai na migration, e não num UPDATE solto no servidor, porque quem é isento é
-- decisão de negócio e precisa estar registrada onde alguém possa revisar. Um
-- comando digitado no banco não deixa rastro nenhum de quando nem por quê.
--
-- `WHERE email IN (...)` torna o comando idempotente e inofensivo em qualquer
-- ambiente onde essas contas não existam.
UPDATE "users"
   SET "isentoCobranca" = true
 WHERE "email" IN (
   'bruteforce@gmail.com',
   'pg@gmail.com',
   'bestbuytech@gmail.com',
   'cliente@frete.teste'
 );
