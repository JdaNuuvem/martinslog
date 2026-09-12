import { z } from 'zod'

/** Página pedida na URL. Valor estranho cai em 1 em vez de quebrar a tela. */
export const paginaLeadsSchema = z.coerce.number().int().min(1).catch(1)

/**
 * Busca livre. O limite de 120 caracteres não é regra de negócio: é para não
 * carregar consulta com texto arbitrariamente longo vindo da query string.
 */
export const buscaLeadsSchema = z.string().trim().max(120).catch('')

export const ORIGENS = ['PEDIDO_PAGO', 'PEDIDO_PENDENTE', 'ENVIO', 'CONVERSA'] as const

export const ROTULO_ORIGEM: Readonly<Record<(typeof ORIGENS)[number], string>> = {
  PEDIDO_PAGO: 'Pedido pago',
  PEDIDO_PENDENTE: 'Pedido não finalizado',
  ENVIO: 'Envio',
  CONVERSA: 'Conversa',
}

export const POR_PAGINA = 50

export type LeadResumo = {
  id: string
  nome: string | null
  email: string | null
  telefone: string | null
  /** Sempre mascarado. O completo não sai da listagem em hipótese nenhuma. */
  cpfMascarado: string | null
  lojas: string[]
  totalPedidos: number
  totalEnvios: number
  valorTotalCentavos: number
  ultimoContatoEm: string
}

export type ResultadoLeads = {
  leads: LeadResumo[]
  total: number
  pagina: number
  porPagina: number
}
