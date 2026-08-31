# Frete

Plataforma de gestão de fretes (cotação, cadastro, carteira, envios, rastreio).

## Pré-requisitos

- Node.js e [pnpm](https://pnpm.io/)
- PostgreSQL acessível (o `docker-compose.yml` na raiz sobe um em `localhost:5433`)

```bash
docker compose up -d
pnpm install
```

## Ambiente de testes (E2E do zero)

Os testes end-to-end (Playwright) rodam contra um banco de teste próprio,
migrado e semeado, e um servidor Next em modo `dev`. Passo a passo para
reproduzir do zero, em qualquer sessão:

```bash
# 1. Aponte para o banco de teste desta sessão (ajuste a porta/nome do banco
#    conforme o que estiver reservado para você — sessões diferentes usam
#    bancos diferentes para não colidir).
export DATABASE_URL_TEST="postgresql://frete:frete@localhost:5433/frete_test_1a"

# 2. Migrations — cria/atualiza o schema no banco de teste.
DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy

# 3. Seed — cria as contas fixas (admin@frete.teste / AdminTeste123! e
#    cliente@frete.teste / ClienteTeste123!), transportadora, serviços e a
#    matriz de tarifas. É idempotente: pode rodar de novo sem duplicar nada.
DATABASE_URL="$DATABASE_URL_TEST" npx tsx prisma/seed.ts

# 4. Rode o E2E. `PLAYWRIGHT_PORT` evita colidir com o dev server de outra
#    sessão; `--workers=1` é obrigatório — os testes compartilham um único
#    banco e servidor, então paralelismo aqui produz falhas falsas por
#    contenção, não falhas reais de aplicação.
export PLAYWRIGHT_PORT=3151
npx playwright test --workers=1
```

O `playwright.config.ts` já sobe o `next dev` sozinho (`webServer`), usando
`DATABASE_URL_TEST` (ou `postgresql://frete:frete@localhost:5433/frete_test`
por padrão) — não é preciso rodar `pnpm dev` à parte.

### Testes de unidade/integração

```bash
DATABASE_URL_TEST="$DATABASE_URL_TEST" npx vitest run
```

Alguns arquivos de teste (ex.: rotas de simulação administrativa) tocam o
mesmo banco compartilhado entre sessões simultâneas e podem falhar
esporadicamente por contenção — não é um problema da suíte. Antes de
investigar como bug, rode o arquivo isolado
(`npx vitest run caminho/do/arquivo.test.ts`); se passar sozinho, foi flake.

## Verificações antes de commitar

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npx playwright test --workers=1
```
