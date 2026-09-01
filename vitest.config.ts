import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Arquivos rodam um de cada vez.
     *
     * A suíte é de integração contra um Postgres real, e parte do estado é
     * **global por natureza**: o catálogo padrão de status (`status_rastreio`
     * com `userId` nulo) e o registro único de `SimulacaoConfig` valem para
     * todos os envios. Com arquivos em paralelo, um teste que configura a
     * cadência de status altera a linha do tempo que outro arquivo está
     * emitindo naquele instante — e o vermelho que aparece não é bug, é
     * corrida entre suítes.
     *
     * O preço é tempo de parede (~110 s contra ~15 s). Vale: teste vermelho
     * que não significa bug destrói o valor da suíte inteira, e foi
     * exatamente isso que apareceu ao cobrir a cadência em dias.
     */
    fileParallelism: false,
    env: {
      // Banco de teste por sessão. Várias sessões rodando a suíte ao mesmo
      // tempo contra o mesmo banco produzem falhas intermitentes por corrida
      // entre elas (colisão de documento/e-mail, carrier em upsert, envios de
      // outra sessão no meio de um teste de concorrência) — e teste vermelho
      // que não significa bug destrói o valor da suíte. Exporte
      // DATABASE_URL_TEST apontando para um banco próprio para se isolar; sem
      // ela, o comportamento é o padrão de sempre.
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ?? 'postgresql://frete:frete@localhost:5433/frete_test',
      SESSION_SECRET: 'x'.repeat(32),
      // Chave mestra da cifra de segredos de terceiros. Valor só de teste;
      // em produção vem do ambiente e não tem padrão nenhum.
      SECRET_ENCRYPTION_KEY: 'y'.repeat(48),
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
