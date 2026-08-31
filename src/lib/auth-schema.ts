import { z } from 'zod'

/**
 * Schemas de validação de borda para cadastro e login, usados tanto pelos
 * formulários no cliente quanto pelos endpoints em `/api/auth`.
 */
export const cadastroRequestSchema = z.object({
  nome: z.string().trim().min(3, 'Informe seu nome completo.'),
  documento: z.string().trim().min(11, 'Informe um CPF ou CNPJ válido.'),
  email: z.string().trim().email('Informe um e-mail válido.'),
  telefone: z.string().trim().min(8, 'Informe um telefone válido.').optional(),
  senha: z.string().min(8, 'A senha precisa ter ao menos 8 caracteres.'),
})

export type CadastroRequest = z.infer<typeof cadastroRequestSchema>

export const loginRequestSchema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe a senha.'),
})

export type LoginRequest = z.infer<typeof loginRequestSchema>
