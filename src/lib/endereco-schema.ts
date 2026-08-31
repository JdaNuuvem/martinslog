import { z } from 'zod'

/**
 * Schema compartilhado entre cliente e servidor para criação/edição de
 * endereços. `documento` é opcional no schema porque só é obrigatório para
 * destinatários — a regra fica no serviço, que já conhece o `tipo`.
 */
export const enderecoRequestSchema = z.object({
  tipo: z.enum(['REMETENTE', 'DESTINATARIO']),
  apelido: z.string().trim().max(120).optional(),
  cep: z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido'),
  logradouro: z.string().trim().min(1, 'Logradouro é obrigatório'),
  numero: z.string().trim().min(1, 'Número é obrigatório'),
  complemento: z.string().trim().max(120).optional(),
  bairro: z.string().trim().min(1, 'Bairro é obrigatório'),
  cidade: z.string().trim().min(1, 'Cidade é obrigatória'),
  uf: z.string().trim().length(2, 'UF deve ter 2 letras'),
  padrao: z.boolean().optional(),
  documento: z.string().trim().optional(),
  // Obrigatório nos dois tipos. A etiqueta precisa do nome de quem envia e de
  // quem recebe, e `POST /api/envios` já recusava o envio sem ele — mas aqui
  // era opcional, então a API aceitava criar um endereço que jamais viraria
  // envio. Duas portas para o mesmo dado com regras diferentes fazem o erro
  // aparecer longe da causa: 201 na criação e falha só na emissão.
  nome: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  email: z.string().trim().email('E-mail inválido').optional().or(z.literal('')),
  telefone: z.string().trim().max(20).optional(),
})

export type EnderecoRequest = z.infer<typeof enderecoRequestSchema>

export type EnderecoResposta = {
  id: string
  tipo: 'REMETENTE' | 'DESTINATARIO'
  apelido: string | null
  cep: string
  logradouro: string
  numero: string
  complemento: string | null
  bairro: string
  cidade: string
  uf: string
  padrao: boolean
  documento: string | null
  nome: string | null
  email: string | null
  telefone: string | null
}
