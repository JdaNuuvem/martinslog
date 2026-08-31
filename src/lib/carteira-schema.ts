import { z } from 'zod'

/**
 * Corpo de `POST /api/carteira/recarga`. O valor chega em centavos, sempre
 * inteiro — a conversão de reais para centavos acontece no cliente, nunca
 * no servidor, para que o servidor só trate um formato de dinheiro.
 */
export const recargaRequestSchema = z.object({
  valorCentavos: z
    .number()
    .int('Valor deve ser um número inteiro de centavos.')
    .positive('Valor deve ser maior que zero.'),
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
