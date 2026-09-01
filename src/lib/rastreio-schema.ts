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

export type RastreioResposta = {
  codigoRastreio: string
  /** Derivado do último evento já ocorrido — nunca do campo escrito à mão. */
  status: string
  servico: string
  prazoDias: number
  criadoEm: string
  eventos: EventoRastreio[]
}
