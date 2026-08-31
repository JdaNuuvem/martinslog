import { z } from 'zod'

/**
 * Schemas da borda HTTP do catálogo padrão de status.
 *
 * Posição em dias e fração do prazo são opcionais e podem vir nulas: nulo
 * significa "sem posição", que é o estado de uma linha que só reescreve o
 * texto de um código existente.
 */

const posicaoDias = z
  .number()
  .min(0, 'A posição em dias não pode ser negativa.')
  .max(365, 'A posição em dias não pode passar de 365.')
  .nullable()
  .optional()

const fracao = z
  .number()
  .positive('A fração do prazo deve ser maior que zero.')
  .max(5, 'A fração do prazo não pode passar de 5.')
  .nullable()
  .optional()

export const salvarStatusPadraoSchema = z.object({
  acao: z.literal('SALVAR'),
  nome: z.string().trim().min(1, 'Informe o nome do status.').max(60),
  titulo: z.string().trim().min(1, 'Informe o título.').max(120),
  descricao: z.string().trim().min(1, 'Informe a descrição.').max(300),
  cenario: z
    .enum(['ENTREGA_NORMAL', 'ATRASO', 'TENTATIVA_FALHA', 'EXTRAVIO', 'DEVOLUCAO'])
    .nullable()
    .optional(),
  fracaoPrazo: fracao,
  diasAposEmissao: posicaoDias,
  statusResultante: z
    .enum(['PENDING', 'RELEASED', 'GENERATED', 'POSTED', 'DELIVERED', 'CANCELLED', 'LOST'])
    .nullable()
    .optional(),
  ativo: z.boolean().optional(),
})

export const removerStatusPadraoSchema = z.object({
  acao: z.literal('REMOVER'),
  id: z.string().trim().min(1, 'Informe o status a remover.'),
})

export const cadenciaSchema = z.object({
  acao: z.literal('CADENCIA'),
  /** 0 desfaz a cadência e devolve o fluxo às frações do prazo. */
  dias: z
    .number()
    .min(0, 'A cadência não pode ser negativa.')
    .max(90, 'A cadência não pode passar de 90 dias.'),
})

export const acaoCatalogoPadraoSchema = z.discriminatedUnion('acao', [
  salvarStatusPadraoSchema,
  removerStatusPadraoSchema,
  cadenciaSchema,
])

export type AcaoCatalogoPadrao = z.infer<typeof acaoCatalogoPadraoSchema>
