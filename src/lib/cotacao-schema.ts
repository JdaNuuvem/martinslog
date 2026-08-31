import { z } from 'zod'

/**
 * Schema único de validação da requisição de cotação, usado tanto pelo
 * formulário no cliente quanto pelo endpoint `POST /api/cotacao` no servidor.
 * Não duplique estas regras em outro lugar — importe deste módulo.
 */
export const cotacaoRequestSchema = z.object({
  cepOrigem: z.string(),
  cepDestino: z.string(),
  formato: z.enum(['CAIXA', 'ROLO', 'ENVELOPE']).default('CAIXA'),
  pesoG: z.number().int().positive().max(30000),
  alturaCm: z.number().positive(),
  larguraCm: z.number().positive(),
  comprimentoCm: z.number().positive(),
})

export type CotacaoRequest = z.infer<typeof cotacaoRequestSchema>

export type OpcaoCotacaoResposta = {
  servicoId: string
  servicoNome: string
  carrierNome: string
  precoBalcaoCentavos: number
  precoFinalCentavos: number
  descontoCentavos: number
  descontoPercentual: number
  prazoDias: number
  disponivel: boolean
  observacao: string | null
}

export type CotacaoResposta = {
  quoteId: string
  pesoCubadoG: number
  pesoTaxavelG: number
  opcoes: OpcaoCotacaoResposta[]
}

export type CotacaoErro = {
  codigo: string
  mensagem: string
  campos?: Record<string, string[] | undefined>
}
