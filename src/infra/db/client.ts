import { PrismaClient } from '@prisma/client'

declare global {
  var __prisma: PrismaClient | undefined
}

/**
 * Teto de tempo de uma transação interativa.
 *
 * O padrão do Prisma é 5 s, e é o certo para o banco ao lado: transação que
 * passa disso está segurando linha demais e vira contenção. Mas a suíte também
 * roda contra um Postgres do outro lado de um túnel SSH, onde cada ida e volta
 * custa centenas de milissegundos — e a emissão de etiqueta faz várias dentro
 * da mesma transação. Lá, catorze testes ficaram vermelhos com "Transaction
 * already closed ... 5269 ms passed", sem um defeito sequer.
 *
 * `PRISMA_TX_TIMEOUT_MS` deixa quem roda contra banco remoto afrouxar sem
 * mexer no arquivo. Ausente, o padrão continua apertado — que é o que se quer
 * em produção, onde transação lenta É sinal de problema. É o mesmo botão que
 * `VITEST_TIMEOUT_MS` já oferece para o tempo do teste; este é para o tempo da
 * transação, que é outra coisa e não se ajusta junto.
 */
const TEMPO_TRANSACAO_MS = Number(process.env.PRISMA_TX_TIMEOUT_MS) || undefined

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient(
    TEMPO_TRANSACAO_MS
      ? { transactionOptions: { timeout: TEMPO_TRANSACAO_MS, maxWait: TEMPO_TRANSACAO_MS } }
      : undefined,
  )

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}
