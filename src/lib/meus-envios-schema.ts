import { z } from 'zod'

/** Abas da tela de rastreio, na ordem em que aparecem. */
export const FILTROS = ['todos', 'pendentes', 'entregues'] as const

export const filtroEnviosSchema = z.enum(FILTROS).catch('todos')

export type FiltroEnvios = (typeof FILTROS)[number]

export type EnvioResumo = {
  id: string
  /** Nulo antes da emissão: envio criado ainda não tem código. */
  codigoRastreio: string | null
  status: string
  /** Título do último evento visível; nulo enquanto nada aconteceu. */
  ultimoEvento: string | null
  ocorridoEm: string | null
  destinatarioNome: string
  destinoCidade: string | null
  destinoUf: string | null
  servico: string
  prazoDias: number
  criadoEm: string
}

export type ListaEnviosResposta = {
  envios: EnvioResumo[]
  contagem: Record<FiltroEnvios, number>
}
