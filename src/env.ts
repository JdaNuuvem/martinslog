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

  /**
   * Se qualquer pessoa pode criar conta pela tela pública.
   *
   * Padrão FECHADO, e o padrão é a parte importante: esquecer de definir a
   * variável mantém a porta trancada. O contrário — aberto por omissão — faria
   * um ambiente novo, ou uma variável perdida numa migração de servidor, abrir
   * o cadastro sem ninguém notar.
   *
   * Fechado, a conta nasce só pelo painel de administração. A tela pública
   * continua respondendo, para não dar erro de rota a quem tiver o link
   * antigo, mas explica que o acesso é concedido pela equipe.
   */
  CADASTRO_PUBLICO: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Conta de SMS da própria plataforma, usada quando o perfil não trouxe a
   * dele.
   *
   * Existe porque a Martins Log decidiu custear o envio: com uma conta só,
   * uma loja passa a avisar o comprador sem contratar nada nem colar chave
   * nenhuma. O `SmsConfig` por perfil continua valendo e tem precedência —
   * é para a loja que quiser pagar o próprio envio e aparecer com o próprio
   * remetente.
   *
   * No SMS brasileiro a diferença entre um e outro é pequena de propósito: o
   * remetente é um número curto, não o nome da loja, então o comprador não
   * distingue quem pagou. Quem precisa aparecer é o nome escrito DENTRO da
   * mensagem.
   */
  SMS_PROVEDOR: z.string().min(1).optional(),
  SMS_CHAVE: z.string().min(1).optional(),
  SMS_IDENTIFICADOR: z.string().optional(),
  SMS_REMETENTE: z.string().optional(),
})

export type Env = z.infer<typeof schema>

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw)
}

export const env = parseEnv(process.env)
