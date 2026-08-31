import { z } from 'zod'

/**
 * Schema da borda HTTP para as ações de papel e acesso de um usuário
 * (`/api/admin/usuarios/[id]/papel`). O papel nunca é aceito sem essa
 * validação — e ainda assim, quem grava a mudança é `alterarPapel`, que
 * revalida quem está de fato chamando contra o banco, não contra o corpo.
 */
export const alterarPapelSchema = z.object({
  papel: z.enum(['ADMIN', 'CLIENTE'], {
    errorMap: () => ({ message: 'Escolha ADMIN ou CLIENTE.' }),
  }),
})

export type AlterarPapelEntrada = z.infer<typeof alterarPapelSchema>
