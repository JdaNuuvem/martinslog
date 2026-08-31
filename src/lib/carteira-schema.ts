import { z } from 'zod'

function formatarReaisPtBr(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Faixa permitida para uma recarga (em centavos). Nomeadas e exportadas de
 * propósito — a Fase 6 vai tornar isso configurável quando o Pix real
 * entrar, e este é o único lugar a mudar.
 *
 * Mínimo: abaixo disso o custo de processar a transação não se paga.
 * Máximo: não impede o cliente de recarregar mais (basta outra recarga) —
 * só limita a exposição de um erro de digitação numa única cobrança.
 */
export const VALOR_MINIMO_RECARGA_CENTAVOS = 500 // R$ 5,00
export const VALOR_MAXIMO_RECARGA_CENTAVOS = 500_000 // R$ 5.000,00

/**
 * Corpo de `POST /api/carteira/recarga`. O valor chega em centavos, sempre
 * inteiro — a conversão de reais para centavos acontece no cliente, nunca
 * no servidor, para que o servidor só trate um formato de dinheiro.
 */
export const recargaRequestSchema = z.object({
  valorCentavos: z
    .number()
    .int('Valor deve ser um número inteiro de centavos.')
    .positive('Valor deve ser maior que zero.')
    .min(
      VALOR_MINIMO_RECARGA_CENTAVOS,
      `O valor mínimo de recarga é ${formatarReaisPtBr(VALOR_MINIMO_RECARGA_CENTAVOS)}.`,
    )
    .max(
      VALOR_MAXIMO_RECARGA_CENTAVOS,
      `O valor máximo de recarga é ${formatarReaisPtBr(VALOR_MAXIMO_RECARGA_CENTAVOS)}.`,
    ),
})

export type RecargaRequest = z.infer<typeof recargaRequestSchema>

/**
 * Corpo de `POST /api/carteira/confirmar` — rota administrativa que
 * confirma uma cobrança Pix simulada e credita a carteira do dono dela.
 */
export const confirmarRecargaRequestSchema = z.object({
  paymentIntentId: z.string().min(1, 'Identificador da cobrança é obrigatório.'),
})

export type ConfirmarRecargaRequest = z.infer<typeof confirmarRecargaRequestSchema>
