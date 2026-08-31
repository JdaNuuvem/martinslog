import { z } from 'zod'

/**
 * Abas da tela de etiquetas, na ordem em que aparecem.
 *
 * `cancelados` agrupa cancelamento e extravio: os dois são desfechos em que
 * o envio não chegou e nada mais vai acontecer com ele. Separá-los em duas
 * abas daria destaque a um caso raro; deixar o extravio só em "todos" o
 * esconderia justamente de quem foi prejudicado.
 */
export const ABAS = [
  'todos',
  'aguardando_postagem',
  'postados',
  'entregues',
  'cancelados',
] as const

export type AbaEtiquetas = (typeof ABAS)[number]

/** Aba inválida na URL cai em `todos` em vez de quebrar a tela. */
export const abaEtiquetasSchema = z.enum(ABAS).catch('todos')

/**
 * Busca livre. O limite de 120 caracteres não é validação de negócio: é para
 * não carregar uma consulta com texto arbitrariamente longo vindo da query
 * string.
 */
export const buscaEtiquetasSchema = z
  .string()
  .trim()
  .max(120)
  .catch('')
  .transform((valor) => valor.slice(0, 120))

export const ROTULOS_ABA: Readonly<Record<AbaEtiquetas, string>> = {
  todos: 'Todos',
  aguardando_postagem: 'Aguardando postagem',
  postados: 'Postados',
  entregues: 'Entregues',
  cancelados: 'Cancelados e extraviados',
}

export type EtiquetaResumo = {
  id: string
  /** Nulo antes da emissão: envio criado ainda não tem código. */
  codigoRastreio: string | null
  status: string
  ultimoEvento: string | null
  ocorridoEm: string | null
  destinatarioNome: string
  destinoCidade: string | null
  destinoUf: string | null
  servico: string
  prazoDias: number
  valorCentavos: number
  criadoEm: string
  /** Se o cliente ainda pode cancelar este envio. */
  podeCancelar: boolean
}

export type ListaEtiquetasResposta = {
  etiquetas: EtiquetaResumo[]
  contagem: Record<AbaEtiquetas, number>
}
