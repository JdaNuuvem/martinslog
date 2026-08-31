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
  /**
   * Token que permite a um agendador externo processar a fila de webhooks
   * sem sessão de administrador. Opcional: sem ele, a rota aceita apenas
   * administradores autenticados e a fila só anda pelo botão do painel.
   *
   * O mínimo de 32 caracteres não é enfeite — este token substitui o login
   * de um administrador em uma rota que dispara requisições para fora, e um
   * valor curto é adivinhável por força bruta. Gere aleatório
   * (`openssl rand -hex 32`) e trate como senha.
   */
  WEBHOOK_CRON_TOKEN: z.string().min(32).optional(),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw)
}

export const env = parseEnv(process.env)
