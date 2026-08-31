import { CodigoRastreioInvalidoError } from '../errors'

/**
 * Geração e validação do código de rastreio.
 *
 * O frete é próprio e o código é nosso (ver
 * `docs/superpowers/specs/2026-08-30-plataforma-frete-design.md` seção 2),
 * mas o **formato** copia a convenção dos Correios para que leitores de
 * código de barras, planilhas e integrações existentes o aceitem sem
 * adaptação: duas letras de serviço, oito dígitos sequenciais, um dígito
 * verificador módulo 11 e o sufixo do país.
 *
 * Copiamos o formato, não a marca: o prefixo vem do nosso próprio catálogo
 * de serviços, e um código gerado aqui nunca colide com um dos Correios
 * porque as siglas de serviço são diferentes.
 *
 * O dígito verificador é o motivo de existir este módulo: sem ele, um erro
 * de digitação na busca do cliente vira a consulta de um envio alheio (que
 * responde "não encontrado" só depois de ir ao banco). Com ele, o erro é
 * detectado no próprio schema, antes de qualquer consulta.
 *
 * Limite conhecido: o módulo 11 mapeia resto 0 e resto 6 para o mesmo
 * dígito (5), então ~1 em 11 erros de um dígito passa. Isso é folga de
 * conforto, não de segurança — a consulta continua restrita ao dono do
 * envio, e um código que escapa da validação apenas devolve "não
 * encontrado" um pouco mais tarde.
 */

/** Sufixo de país, fixo — o serviço é doméstico. */
export const SUFIXO_PAIS = 'BR'

/** Prefixo usado quando o código do serviço não fornece duas letras. */
export const PREFIXO_PADRAO = 'FR'

/** Maior sequencial representável nos oito dígitos do código. */
export const SEQUENCIAL_MAXIMO = 99_999_999

const PESOS_MODULO_11 = [8, 6, 4, 2, 3, 5, 9, 7] as const
const DIGITOS_SEQUENCIAIS = PESOS_MODULO_11.length

const FORMATO_CODIGO = /^([A-Z]{2})(\d{8})(\d)(BR)$/

/**
 * Dígito verificador módulo 11 dos oito dígitos sequenciais.
 *
 * Os dois restos excepcionais seguem a convenção dos Correios: resto 0
 * produz 5 e resto 1 produz 0, porque `11 - resto` cairia fora da faixa de
 * um único dígito nesses dois casos.
 */
export function calcularDigitoVerificador(digitos: string): number {
  if (!/^\d{8}$/.test(digitos)) {
    throw new CodigoRastreioInvalidoError(
      `Sequencial do código de rastreio deve ter exatamente ${DIGITOS_SEQUENCIAIS} dígitos, recebido: ${digitos}`,
    )
  }

  const soma = PESOS_MODULO_11.reduce(
    (total, peso, indice) => total + Number(digitos.charAt(indice)) * peso,
    0,
  )

  const resto = soma % 11
  if (resto === 0) return 5
  if (resto === 1) return 0
  return 11 - resto
}

/**
 * Monta o código a partir do prefixo do serviço e de um sequencial vindo da
 * sequência do banco. O sequencial é a única fonte de unicidade: o prefixo
 * varia por serviço e não participa dela, então dois serviços nunca podem
 * produzir o mesmo código.
 */
export function montarCodigoRastreio(prefixo: string, sequencial: number): string {
  const prefixoNormalizado = prefixo.toUpperCase()
  if (!/^[A-Z]{2}$/.test(prefixoNormalizado)) {
    throw new CodigoRastreioInvalidoError(
      `Prefixo do código de rastreio deve ter duas letras, recebido: ${prefixo}`,
    )
  }

  if (!Number.isInteger(sequencial) || sequencial < 1 || sequencial > SEQUENCIAL_MAXIMO) {
    throw new CodigoRastreioInvalidoError(
      `Sequencial do código de rastreio deve ser um inteiro entre 1 e ${SEQUENCIAL_MAXIMO}, recebido: ${sequencial}`,
    )
  }

  const digitos = String(sequencial).padStart(DIGITOS_SEQUENCIAIS, '0')
  return `${prefixoNormalizado}${digitos}${calcularDigitoVerificador(digitos)}${SUFIXO_PAIS}`
}

/**
 * Valida formato e dígito verificador. Nunca lança: um código digitado pelo
 * cliente é entrada externa, e quem chama decide o que fazer com `false`.
 */
export function validarCodigoRastreio(codigo: string): boolean {
  if (!FORMATO_CODIGO.test(codigo)) {
    return false
  }

  // As posições são fixas pelo formato já validado acima: duas letras de
  // prefixo, oito dígitos sequenciais, o verificador e o sufixo do país.
  const digitos = codigo.slice(2, 2 + DIGITOS_SEQUENCIAIS)
  const digitoVerificador = codigo.charAt(2 + DIGITOS_SEQUENCIAIS)

  return calcularDigitoVerificador(digitos) === Number(digitoVerificador)
}

/**
 * Deriva o prefixo de duas letras do código do serviço (`ECONOMICO` → `EC`).
 * Acentos e separadores são descartados antes, para que o código do serviço
 * possa evoluir sem quebrar a geração; se ainda assim não sobrarem duas
 * letras, cai no prefixo padrão em vez de gerar um código malformado.
 */
export function prefixoDoServico(codigoServico: string): string {
  const somenteLetras = codigoServico
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()

  return somenteLetras.length >= 2 ? somenteLetras.slice(0, 2) : PREFIXO_PADRAO
}
