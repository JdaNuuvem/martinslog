import { z } from 'zod'

/** Schemas da borda HTTP das telas de transportadoras e serviços. */

const dimensao = z.number().positive('As dimensões devem ser positivas.').optional()

export const salvarTransportadoraSchema = z.object({
  acao: z.literal('SALVAR_TRANSPORTADORA'),
  id: z.string().trim().min(1).optional(),
  nome: z.string().trim().min(1, 'Informe o nome da transportadora.').max(80),
  ativo: z.boolean().optional(),
})

export const salvarServicoSchema = z.object({
  acao: z.literal('SALVAR_SERVICO'),
  id: z.string().trim().min(1).optional(),
  carrierId: z.string().trim().min(1, 'Escolha a transportadora.'),
  codigo: z.string().trim().min(1, 'Informe o código do serviço.').max(40),
  nome: z.string().trim().min(1, 'Informe o nome do serviço.').max(80),
  prazoBase: z
    .number()
    .int('O prazo base deve ser um número inteiro de dias.')
    .min(1, 'O prazo base mínimo é 1 dia.')
    .max(120, 'O prazo base não pode passar de 120 dias.'),
  limitePesoG: z
    .number()
    .int('O limite de peso deve ser um inteiro em gramas.')
    .min(1, 'O limite de peso deve ser positivo.')
    .max(100_000, 'O limite de peso não pode passar de 100.000 g.'),
  limiteDimensoes: z
    .object({ alturaCm: dimensao, larguraCm: dimensao, comprimentoCm: dimensao })
    .optional(),
  exigePudo: z.boolean().optional(),
  entregaSabado: z.boolean().optional(),
  ativo: z.boolean().optional(),
})

export const alternarSchema = z.object({
  acao: z.literal('ALTERNAR'),
  alvo: z.enum(['SERVICO', 'TRANSPORTADORA']),
  id: z.string().trim().min(1),
  ativo: z.boolean(),
})

export const acaoServicosSchema = z.discriminatedUnion('acao', [
  salvarTransportadoraSchema,
  salvarServicoSchema,
  alternarSchema,
])

export type AcaoServicos = z.infer<typeof acaoServicosSchema>
