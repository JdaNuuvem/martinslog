import { z } from 'zod'
import { validarCodigoRastreio } from '@/domain/shipment/codigo-rastreio'
import type { CodigoEvento } from '@/domain/simulacao/tipos'

/**
 * Normaliza o que o cliente digita (espaços, hífens, minúsculas) e delega a
 * validação ao domínio, que confere formato e dígito verificador. Assim o
 * campo do formulário rejeita erro de digitação antes da ida ao servidor,
 * sem duplicar a regra do código.
 */
export const codigoRastreioSchema = z
  .string()
  .trim()
  .transform((valor) => valor.replace(/[\s-]/g, '').toUpperCase())
  .refine(validarCodigoRastreio, 'Código de rastreio inválido')

export type EventoRastreio = {
  sequencia: number
  codigo: CodigoEvento | string
  /** Linha destacada da timeline; a descrição é o texto de apoio. */
  titulo: string
  descricao: string
  unidadeOrigem: string | null
  unidadeDestino: string | null
  cidade: string
  uf: string
  ocorridoEm: string
}

/**
 * Forma do percurso configurado pela conta, para o rastreio público desenhar
 * o fluxo. Carrega o que a encomenda percorre, **nunca quando** — a data de
 * uma etapa futura é justamente o que a seção 7 da spec proíbe mostrar.
 */
export type FluxoPublico = {
  nos: { id: string; codigo: string; titulo: string; x: number | null; y: number | null }[]
  conexoes: { de: string; para: string }[]
}

export type RastreioResposta = {
  fluxo: FluxoPublico
  codigoRastreio: string
  /** Derivado do último evento já ocorrido — nunca do campo escrito à mão. */
  status: string
  servico: string
  prazoDias: number
  criadoEm: string
  eventos: EventoRastreio[]
}
