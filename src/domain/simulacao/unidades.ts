import type { LocalidadeSimulacao } from './tipos'

/** Operador neutro padrão: o frete é próprio, não usar marca de terceiro. */
export const OPERADOR_PADRAO = 'DE ENCOMENDAS'

/**
 * Normaliza cidade/UF para o formato observado na referência visual:
 * maiúsculas e sem acentos (`SAO PAULO/SP`).
 */
export function normalizarLocalidade({ cidade, uf }: LocalidadeSimulacao): string {
  const semAcento = (texto: string) =>
    texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()

  return `${semAcento(cidade)}/${semAcento(uf)}`
}

export function unidadeAgencia(local: LocalidadeSimulacao, operador = OPERADOR_PADRAO): string {
  const sufixo = operador.trim() ? ` ${operador.trim().toUpperCase()}` : ''
  return `AGÊNCIA${sufixo}- ${normalizarLocalidade(local)}`
}

export function unidadeTratamento(local: LocalidadeSimulacao): string {
  return `UNIDADE DE TRATAMENTO- ${normalizarLocalidade(local)}`
}

export function unidadeDistribuicao(local: LocalidadeSimulacao): string {
  return `UNIDADE DE DISTRIBUIÇÃO- ${normalizarLocalidade(local)}`
}

export const UNIDADE_SISTEMA = 'INTERFACE DO SISTEMA- BR'

/**
 * Duas cidades são a mesma rota local quando cidade e UF coincidem depois
 * da normalização — é isso que decide se o roteiro tem uma transferência
 * ou duas.
 */
export function mesmaLocalidade(a: LocalidadeSimulacao, b: LocalidadeSimulacao): boolean {
  return normalizarLocalidade(a) === normalizarLocalidade(b)
}
