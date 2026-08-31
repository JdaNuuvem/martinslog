/**
 * Política de retentativa das entregas de webhook, conforme o critério de
 * aceite da Tarefa 4.3 do roadmap.
 */

/** Espera antes de cada nova tentativa, em minutos. */
export const ATRASOS_MINUTOS = [1, 5, 30, 120, 720] as const

/**
 * Tentativas totais por entrega: a primeira, imediata, mais as cinco
 * reagendadas de `ATRASOS_MINUTOS`. Depois disto a entrega é dada como
 * perdida e para de consumir fila.
 */
export const MAXIMO_TENTATIVAS = ATRASOS_MINUTOS.length + 1

/**
 * Quando tentar de novo, dado quantas tentativas já falharam.
 *
 * `null` significa desistir: cinco tentativas cobrem cerca de catorze horas,
 * tempo suficiente para um endpoint voltar de uma queda. Insistir além disso
 * empilha entregas mortas que competem com as vivas pela mesma fila.
 */
export function proximaTentativaEm(tentativasFeitas: number, agora = new Date()): Date | null {
  const atraso = ATRASOS_MINUTOS[tentativasFeitas - 1]
  if (atraso === undefined) {
    return null
  }

  return new Date(agora.getTime() + atraso * 60 * 1000)
}

/**
 * Decide se vale repetir, a partir da resposta obtida.
 *
 * A distinção que importa: erro do servidor do cliente (5xx), excesso de
 * requisições (429), tempo esgotado (408) e falha de rede são transitórios —
 * repetir tem chance de funcionar. Erro do cliente (4xx em geral) é
 * permanente: URL errada, rota removida, autenticação recusada. Repetir uma
 * entrega para um 404 apenas martela o servidor alheio catorze horas a fio
 * sem nenhuma chance de sucesso.
 */
export function deveRetentar(statusHttp: number | null): boolean {
  if (statusHttp === null) {
    return true
  }

  if (statusHttp === 429 || statusHttp === 408) {
    return true
  }

  return statusHttp >= 500
}
