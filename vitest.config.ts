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
    /**
     * Cinco segundos é pouco quando o banco não está ao lado.
     *
     * A suíte fala com um Postgres de verdade, e o tempo de uma consulta
     * depende de onde ele está: local, custa milissegundos; atrás de um túnel
     * SSH até o servidor, custa centenas. Com o padrão de 5s, vinte e um
     * testes ficaram vermelhos com "Test timed out" enquanto os vizinhos
     * passavam em 4,8s — vermelho que não significa defeito nenhum, e que faz
     * perder tempo procurando bug onde só havia latência.
     *
     * `VITEST_TIMEOUT_MS` deixa quem roda contra um banco remoto afrouxar sem
     * mexer no arquivo. O padrão continua apertado para o banco local, onde
     * teste lento É sinal de problema.
     */
    testTimeout: Number(process.env.VITEST_TIMEOUT_MS) || 5_000,
    hookTimeout: Number(process.env.VITEST_TIMEOUT_MS) || 10_000,
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
