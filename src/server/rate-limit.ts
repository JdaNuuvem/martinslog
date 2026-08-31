/**
 * Rate limit genérico em memória de processo, por janela fixa.
 *
 * Serve endpoints públicos sem noção de identidade (ex.: consulta de
 * rastreio por código). O rate limit de autenticação é outro módulo
 * (`@/server/auth/rate-limit`): lá a cota tem duas dimensões, IP e e-mail,
 * e regras de consumo diferentes para sucesso e falha.
 *
 * Como todo estado vive no processo, isto vale para uma instância única. Em
 * múltiplas instâncias o limite efetivo se multiplica pelo número de
 * processos, e a contagem precisa migrar para armazenamento compartilhado
 * (ex.: Redis).
 */

export interface PoliticaCota {
  /** Namespace do contador — separa limites de endpoints diferentes. */
  escopo: string
  /** Requisições permitidas por janela. */
  limite: number
  janelaMs: number
}

export interface ResultadoCota {
  permitido: boolean
  /** Requisições ainda disponíveis na janela atual. */
  restante: number
  /** Segundos até a janela reabrir — vira `Retry-After` na resposta 429. */
  reabreEmSegundos: number
}

interface Registro {
  contagem: number
  expiraEm: number
}

const registros = new Map<string, Registro>()

/**
 * Consome uma unidade de cota e informa se a requisição pode prosseguir.
 * A requisição bloqueada também conta: quem insiste durante o bloqueio não
 * ganha nada, e a janela só reabre depois de expirar.
 */
export function consumirCota(politica: PoliticaCota, identificador: string): ResultadoCota {
  const chave = `${politica.escopo}:${identificador.toLowerCase()}`
  const agora = Date.now()
  const atual = registros.get(chave)

  if (!atual || atual.expiraEm <= agora) {
    const expiraEm = agora + politica.janelaMs
    registros.set(chave, { contagem: 1, expiraEm })
    return {
      permitido: true,
      restante: politica.limite - 1,
      reabreEmSegundos: Math.ceil(politica.janelaMs / 1000),
    }
  }

  atual.contagem += 1
  const reabreEmSegundos = Math.max(1, Math.ceil((atual.expiraEm - agora) / 1000))

  return {
    permitido: atual.contagem <= politica.limite,
    restante: Math.max(0, politica.limite - atual.contagem),
    reabreEmSegundos,
  }
}

/** Apenas para testes: zera todos os contadores. */
export function limparCotas(): void {
  registros.clear()
}
