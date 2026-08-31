import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { env } from '@/env'

/**
 * Autenticação do agendador que processa a fila de webhooks.
 *
 * Existe porque a retentativa exponencial (1min, 5min, 30min, 2h, 12h) só
 * avança se alguém chamar a rota periodicamente, e um cron não tem cookie de
 * sessão. O token é a alternativa: vale só para esta rota, e só para
 * processar a fila.
 *
 * Sem `WEBHOOK_CRON_TOKEN` configurado, nenhuma requisição passa por aqui —
 * a rota continua exigindo administrador autenticado. Uma variável ausente
 * nunca deve virar porta aberta.
 */
export function tokenDeCronValido(
  request: NextRequest,
  esperado = env.WEBHOOK_CRON_TOKEN,
): boolean {
  if (!esperado) {
    return false
  }

  const cabecalho = request.headers.get('authorization') ?? ''
  const prefixo = 'Bearer '
  if (!cabecalho.startsWith(prefixo)) {
    return false
  }

  const recebido = cabecalho.slice(prefixo.length).trim()

  // Comparação em tempo constante: com `===`, o tempo de resposta revela
  // quantos caracteres iniciais o atacante acertou, e o token pode ser
  // descoberto byte a byte. O comprimento diferente sai antes porque
  // `timingSafeEqual` exige buffers do mesmo tamanho — e o tamanho do token
  // não é segredo.
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}
