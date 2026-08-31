import { createHmac, timingSafeEqual } from 'crypto'

/** Cabeçalho que carrega a assinatura, no formato `sha256=<hex>`. */
export const CABECALHO_ASSINATURA = 'x-frete-signature'

/** Cabeçalho com o instante da assinatura, em segundos desde a época Unix. */
export const CABECALHO_TIMESTAMP = 'x-frete-timestamp'

/**
 * Quanto tempo uma entrega assinada continua aceitável. Cinco minutos é
 * folga suficiente para relógios desalinhados entre servidores e curta o
 * bastante para que uma requisição capturada não sirva para sempre.
 */
export const JANELA_TOLERANCIA_SEGUNDOS = 5 * 60

export type Assinatura = {
  assinatura: string
  timestamp: string
}

/**
 * Assina o corpo da entrega com HMAC-SHA256.
 *
 * O timestamp entra **dentro** do que é assinado, não apenas ao lado. Se
 * apenas o corpo fosse assinado, quem capturasse uma requisição poderia
 * reenviá-la indefinidamente, sempre com assinatura válida. Assinando
 * `<timestamp>.<corpo>`, alterar o instante invalida a assinatura, e forjar
 * uma nova exige o segredo.
 */
export function assinarPayload(segredo: string, corpo: string, agora = new Date()): Assinatura {
  const timestamp = String(Math.floor(agora.getTime() / 1000))
  const digest = createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex')

  return { assinatura: `sha256=${digest}`, timestamp }
}

/**
 * Verifica uma entrega recebida. É esta função que o cliente replica do lado
 * dele, e é ela que a documentação descreve.
 *
 * Duas defesas, ambas necessárias:
 * - **Comparação em tempo constante.** Comparar com `===` vaza, pelo tempo
 *   de resposta, quantos bytes iniciais o atacante acertou, o que permite
 *   descobrir a assinatura byte a byte.
 * - **Janela de tolerância.** Assinatura válida mas antiga é recusada, para
 *   que uma requisição capturada não possa ser reenviada depois.
 */
export function verificarAssinatura(
  segredo: string,
  corpo: string,
  assinaturaRecebida: string,
  timestampRecebido: string,
  agora = new Date(),
): boolean {
  if (!/^\d+$/.test(timestampRecebido)) {
    return false
  }

  const distanciaSegundos = Math.abs(
    Math.floor(agora.getTime() / 1000) - Number(timestampRecebido),
  )
  if (distanciaSegundos > JANELA_TOLERANCIA_SEGUNDOS) {
    return false
  }

  const esperada = createHmac('sha256', segredo)
    .update(`${timestampRecebido}.${corpo}`)
    .digest('hex')

  const prefixo = 'sha256='
  if (!assinaturaRecebida.startsWith(prefixo)) {
    return false
  }

  const recebidaHex = assinaturaRecebida.slice(prefixo.length)
  // `timingSafeEqual` exige buffers do mesmo tamanho: comprimento diferente
  // já é assinatura errada, e sair aqui não vaza nada além do tamanho, que
  // é fixo e público.
  if (recebidaHex.length !== esperada.length || !/^[0-9a-f]+$/.test(recebidaHex)) {
    return false
  }

  return timingSafeEqual(Buffer.from(recebidaHex, 'hex'), Buffer.from(esperada, 'hex'))
}
