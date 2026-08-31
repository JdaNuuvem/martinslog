import type { NextRequest } from 'next/server'
import { env } from '@/env'

/** IP usado quando não há origem confiável — todos caem no mesmo balde. */
export const IP_DESCONHECIDO = 'desconhecido'

/**
 * Determina o IP de origem para rate limit. `x-forwarded-for` e `x-real-ip`
 * são cabeçalhos que o próprio cliente pode enviar — só são confiáveis
 * quando um proxy reverso na frente da aplicação os sobrescreve (sinalizado
 * por `TRUST_PROXY_HEADERS`). Sem um proxy confiável, usá-los permite
 * contornar o limite trocando o cabeçalho a cada tentativa; por isso, com
 * `TRUST_PROXY_HEADERS` falso eles são ignorados por completo.
 *
 * Quando confiável, prioriza `x-real-ip` (tipicamente fixado pelo proxy
 * para o IP real de um único salto) e, na ausência dele, usa o *último*
 * salto de `x-forwarded-for` — o mais próximo do proxy e, portanto, o único
 * trecho da cadeia que o proxy realmente controla; o primeiro salto é
 * escrito pelo cliente e pode ser qualquer coisa.
 */
export function obterIp(request: NextRequest): string {
  if (!env.TRUST_PROXY_HEADERS) {
    return IP_DESCONHECIDO
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  const encaminhado = request.headers.get('x-forwarded-for')
  if (encaminhado) {
    const saltos = encaminhado.split(',').map((salto) => salto.trim())
    const ultimoSalto = saltos[saltos.length - 1]
    if (ultimoSalto) {
      return ultimoSalto
    }
  }

  return IP_DESCONHECIDO
}
