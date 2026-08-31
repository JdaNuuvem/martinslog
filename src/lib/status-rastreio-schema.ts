import { z } from 'zod'

/** Cenários da simulação, espelhados do enum do Prisma. */
export const CENARIOS = [
  'ENTREGA_NORMAL',
  'ATRASO',
  'TENTATIVA_FALHA',
  'EXTRAVIO',
  'DEVOLUCAO',
] as const

/**
 * Status de envio oferecidos na tela. Os terminais (DELIVERED, LOST,
 * CANCELLED) ficam de fora: encerram o envio e travariam a timeline se
 * viessem de um evento intermediário.
 */
export const STATUS_RESULTANTES = ['GENERATED', 'POSTED'] as const

export const statusRastreioRequestSchema = z
  .object({
    nome: z.string().trim().min(2, 'Informe um nome para o status.'),
    titulo: z.string().trim().min(1, 'O título aparece na timeline e é obrigatório.'),
    descricao: z.string().trim().min(1, 'A descrição aparece na timeline e é obrigatória.'),
    cenario: z.enum(CENARIOS).nullable().optional(),
    fracaoPrazo: z.number().positive().max(5).nullable().optional(),
    statusResultante: z.enum(STATUS_RESULTANTES).nullable().optional(),
    ativo: z.boolean().optional(),
  })
  .refine(
    (dados) =>
      dados.fracaoPrazo == null || (dados.cenario != null && dados.statusResultante != null),
    {
      message: 'Um status que entra na linha do tempo precisa de cenário e status resultante.',
      path: ['fracaoPrazo'],
    },
  )

export type StatusRastreioRequest = z.infer<typeof statusRastreioRequestSchema>

export type StatusRastreioResposta = {
  id: string
  codigo: string
  titulo: string
  descricao: string
  cenario: (typeof CENARIOS)[number] | null
  fracaoPrazo: number | null
  statusResultante: (typeof STATUS_RESULTANTES)[number] | null
  ativo: boolean
}
