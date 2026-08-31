import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Quando `true`, confia nos cabeçalhos de IP definidos por um proxy
   * reverso (`x-real-ip`, `x-forwarded-for`) para o rate limit por IP.
   * Padrão `false`: em ambiente sem proxy confiável na frente, esses
   * cabeçalhos são controlados pelo próprio cliente e não devem ser
   * usados para identificar o IP de origem.
   */
  TRUST_PROXY_HEADERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw)
}

export const env = parseEnv(process.env)
