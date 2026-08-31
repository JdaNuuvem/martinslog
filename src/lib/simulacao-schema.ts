import { z } from 'zod'

/**
 * Schemas da borda HTTP dos controles administrativos da simulação. Validar
 * aqui, e não dentro do serviço, mantém a mensagem de erro adequada ao
 * cliente HTTP; o serviço ainda valida por conta própria, porque ele também
 * é chamado de outros caminhos.
 */

/**
 * Fator de velocidade da simulação. O teto de 10.000 não é arbitrário: com
 * fator alto demais a linha do tempo inteira cai dentro do mesmo instante e
 * a simulação deixa de ser observável — todos os eventos aparecem de uma vez.
 */
export const fatorVelocidadeSchema = z.object({
  fatorVelocidade: z
    .number({ invalid_type_error: 'Informe o fator de velocidade.' })
    .int('O fator de velocidade deve ser um número inteiro.')
    .min(1, 'O fator de velocidade mínimo é 1 (tempo real).')
    .max(10_000, 'O fator de velocidade máximo é 10.000.'),
})

export const cenarioSimulacaoSchema = z.enum([
  'ENTREGA_NORMAL',
  'ATRASO',
  'TENTATIVA_FALHA',
  'EXTRAVIO',
  'DEVOLUCAO',
])

/**
 * Ações sobre a linha do tempo de um envio. `TROCAR_CENARIO` é a única que
 * exige `cenario`, e o refinamento abaixo é o que impede uma troca de
 * cenário sem cenário informado chegar ao serviço.
 */
export const acaoSimulacaoSchema = z
  .object({
    acao: z.enum(['TROCAR_CENARIO', 'FORCAR_EVENTO', 'REINICIAR', 'APLICAR_STATUS']),
    cenario: cenarioSimulacaoSchema.optional(),
    /** Código do status a aplicar. Só `APLICAR_STATUS` o usa. */
    codigo: z.string().trim().min(1).max(60).optional(),
  })
  .refine((valor) => valor.acao !== 'TROCAR_CENARIO' || valor.cenario !== undefined, {
    message: 'Informe o cenário para trocar o cenário do envio.',
    path: ['cenario'],
  })
  .refine((valor) => valor.acao !== 'APLICAR_STATUS' || valor.codigo !== undefined, {
    message: 'Informe o status a aplicar.',
    path: ['codigo'],
  })

export type FatorVelocidadeRequest = z.infer<typeof fatorVelocidadeSchema>
export type AcaoSimulacaoRequest = z.infer<typeof acaoSimulacaoSchema>
