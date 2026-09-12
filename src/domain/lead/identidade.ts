import { createHmac } from 'crypto'

/**
 * Como duas aparições da mesma pessoa são reconhecidas como a mesma pessoa.
 *
 * Tudo aqui é puro e sem banco: é a camada que decide o que é igual, e ela
 * precisa ser exercitável sem subir nada.
 */

/** CPF em dígitos, ou `null` quando não há CPF utilizável. */
export function normalizarCpf(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? '').replace(/\D/g, '')
  return digitos.length === 11 ? digitos : null
}

/**
 * Telefone em dígitos, sem o DDI do Brasil.
 *
 * O DDI cai porque a mesma pessoa chega com ele pela conversa do WhatsApp e
 * sem ele pelo pedido da loja. Mantê-lo faria o lead duplicar exatamente no
 * caso mais comum.
 *
 * O piso de dez dígitos é o telefone brasileiro com DDD; abaixo disso o
 * valor não identifica ninguém e vale mais ficar sem chave do que juntar
 * duas pessoas por engano.
 */
export function normalizarTelefoneLead(bruto: string | null | undefined): string | null {
  let digitos = (bruto ?? '').replace(/\D/g, '')

  if (digitos.length > 11 && digitos.startsWith('55')) {
    digitos = digitos.slice(2)
  }

  return digitos.length >= 10 && digitos.length <= 11 ? digitos : null
}

/** E-mail em minúsculas, ou `null` quando não parece e-mail. */
export function normalizarEmail(bruto: string | null | undefined): string | null {
  const limpo = (bruto ?? '').trim().toLowerCase()
  if (!limpo) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo) ? limpo : null
}

/**
 * A impressão digital do CPF: HMAC-SHA256 com o segredo do servidor.
 *
 * **Não é SHA-256 puro, e a diferença é o recurso inteiro.** Existem cerca
 * de um bilhão de CPFs válidos. Um hash sem segredo é invertido testando
 * todos eles, o que leva segundos numa placa de vídeo comum — seria guardar
 * o CPF em claro com passos a mais. Com o HMAC, quem rouba a tabela não tem
 * como voltar ao número sem também roubar o segredo.
 *
 * Lança quando o segredo não está configurado, em vez de cair para um valor
 * padrão: um padrão embutido estaria publicado junto com o repositório e
 * anularia a proteção em silêncio.
 */
export function impressaoDigitalCpf(cpf: string): string {
  const segredo = process.env.LEAD_FINGERPRINT_KEY

  if (!segredo || segredo.length < 32) {
    throw new Error(
      'LEAD_FINGERPRINT_KEY ausente ou curta demais (mínimo 32 caracteres). ' +
        'Sem ela, o CPF não pode virar chave de identidade sem ficar exposto.',
    )
  }

  return createHmac('sha256', segredo).update(cpf).digest('hex')
}
